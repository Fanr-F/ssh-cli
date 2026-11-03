import crypto from 'node:crypto';
import { ConnectionConfig } from '../types/connection';
import {
  getConfigPath,
  readPrivateFile,
  writePrivateFileAtomic,
} from './config';
import {
  hasStoredSecrets,
  parseConnections,
  serializeConnections,
} from './schema';
import {
  deleteConnectionCredentials,
  getCredential,
  setCredential,
  type CredentialKind,
} from './credentials';
import { createLogger } from '../logger';

const log = createLogger('storage');

interface SecretFields {
  password: boolean;
  passphrase: boolean;
}

const ALL_SECRETS: SecretFields = { password: true, passphrase: true };

/** Keychain operations used by the store; injectable for tests. */
export interface CredentialStore {
  get(id: string, kind: CredentialKind): Promise<string | null>;
  set(id: string, kind: CredentialKind, value: string | undefined): Promise<void>;
  deleteAll(id: string): Promise<void>;
}

/** Optional overrides; the defaults target the real config file and keychain. */
export interface ConnectionStoreOptions {
  configPath?: string;
  readFile?: (path: string) => Promise<string | null>;
  writeFile?: (path: string, contents: string) => Promise<void>;
  credentials?: CredentialStore;
}

const DEFAULT_CREDENTIALS: CredentialStore = {
  get: getCredential,
  set: setCredential,
  deleteAll: deleteConnectionCredentials,
};

export class ConnectionStore {
  private migrationChecked = false;
  private firstLoad: Promise<ConnectionConfig[]> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  /** >0 while a queued write task is running (load() must not re-enqueue). */
  private queueDepth = 0;

  private readonly configPath: string;
  private readonly readFile: (path: string) => Promise<string | null>;
  private readonly writeFile: (path: string, contents: string) => Promise<void>;
  private readonly credentials: CredentialStore;

  constructor(options: ConnectionStoreOptions = {}) {
    this.configPath = options.configPath ?? getConfigPath();
    this.readFile = options.readFile ?? readPrivateFile;
    this.writeFile = options.writeFile ?? writePrivateFileAtomic;
    this.credentials = options.credentials ?? DEFAULT_CREDENTIALS;
  }

  /**
   * Load connection metadata. Missing files return an empty list; malformed
   * JSON or invalid entries throw so they cannot be silently overwritten.
   *
   * The one-time legacy migration runs inside the write queue so it cannot
   * race with a queued save/add/update.
   */
  async load(): Promise<ConnectionConfig[]> {
    if (this.migrationChecked) {
      return this.readConnections();
    }

    if (!this.firstLoad) {
      const migrate = async (): Promise<ConnectionConfig[]> => {
        const connections = await this.readConnections();
        await this.migrateLegacySecrets(connections);
        return connections;
      };

      const run = this.queueDepth > 0 ? migrate() : this.enqueue(migrate);
      this.firstLoad = run.then(
        (connections) => {
          this.migrationChecked = true;
          return connections;
        },
        (err) => {
          // Allow a later load to retry after a transient read failure.
          this.firstLoad = null;
          throw err;
        },
      );
    }

    const connections = await this.firstLoad;
    // Hand out copies: callers such as add() mutate the list they receive.
    return connections.map((connection) => ({ ...connection }));
  }

  private async readConnections(): Promise<ConnectionConfig[]> {
    const filePath = this.configPath;
    let raw: string | null;
    try {
      raw = await this.readFile(filePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not read ${filePath}: ${reason}`);
    }

    if (raw === null) return [];

    try {
      return parseConnections(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not load ${filePath}: ${reason}`);
    }
  }

  /**
   * Older versions wrote passwords/passphrases into config.json. Move them to
   * the OS keychain once, then rewrite the metadata without secrets.
   * If the keychain is unavailable, keep the file untouched so the user can
   * still connect; the next launch will retry the migration.
   */
  private async migrateLegacySecrets(connections: ConnectionConfig[]): Promise<void> {
    const legacy = connections.filter(hasStoredSecrets);
    if (legacy.length === 0) return;

    try {
      let count = 0;
      for (const connection of connections) {
        if (connection.password !== undefined) {
          await this.credentials.set(connection.id, 'password', connection.password);
          count++;
        }
        if (connection.passphrase !== undefined) {
          await this.credentials.set(connection.id, 'passphrase', connection.passphrase);
          count++;
        }
      }

      await this.writeConnections(connections);
      for (const connection of connections) {
        delete connection.password;
        delete connection.passphrase;
      }
      log.info('Migrated {count} credential(s) to the OS keychain', { count });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.warn('Could not migrate legacy credentials; config left unchanged: {reason}', { reason });
    }
  }

  /**
   * Save metadata only. Credentials are updated by add/update so that a plain
   * metadata save cannot accidentally delete existing keychain entries.
   */
  async save(connections: ConnectionConfig[]): Promise<void> {
    await this.enqueue(async () => {
      await this.writeConnections(connections);
    });
  }

  /**
   * Add a new connection. Generates UUID if id is missing.
   */
  async add(connection: ConnectionConfig): Promise<void> {
    await this.enqueue(async () => {
      const connections = await this.load();
      const newConn = {
        ...connection,
        id: connection.id || crypto.randomUUID(),
        createdAt: connection.createdAt || new Date().toISOString(),
      };

      let toClear: Array<{ id: string; kind: CredentialKind }>;
      try {
        toClear = await this.stageSecrets(newConn, ALL_SECRETS);
        connections.push(newConn);
        await this.writeConnections(connections);
      } catch (err) {
        // The config was not committed, so remove any credentials just staged
        // for this brand-new id.
        await this.credentials.deleteAll(newConn.id);
        throw err;
      }
      await this.clearSecrets(toClear);
    });
  }

  /**
   * Update an existing connection by ID.
   */
  async update(id: string, updates: Partial<ConnectionConfig>): Promise<void> {
    await this.enqueue(async () => {
      const connections = await this.load();
      const index = connections.findIndex(c => c.id === id);

      if (index === -1) {
        throw new Error(`Connection not found: ${id}`);
      }

      const previous = connections[index];
      const next = { ...previous, ...updates, id };
      const authChanged = updates.authType !== undefined && updates.authType !== previous.authType;
      const fields: SecretFields = {
        password: authChanged || Object.prototype.hasOwnProperty.call(updates, 'password'),
        passphrase: authChanged || Object.prototype.hasOwnProperty.call(updates, 'passphrase'),
      };

      // Remember the current credentials before staging so a failed config
      // write can roll the keychain back instead of leaving it out of sync.
      const snapshot = await this.snapshotSecrets(id, fields);
      let toClear: Array<{ id: string; kind: CredentialKind }> = [];
      try {
        toClear = await this.stageSecrets(next, fields);
        connections[index] = next;
        await this.writeConnections(connections);
      } catch (err) {
        await this.restoreSecrets(id, snapshot);
        throw err;
      }
      await this.clearSecrets(toClear);
    });
  }

  /**
   * Remove a connection by ID.
   */
  async remove(id: string): Promise<void> {
    await this.enqueue(async () => {
      const connections = await this.load();
      const filtered = connections.filter(c => c.id !== id);

      if (filtered.length === connections.length) {
        throw new Error(`Connection not found: ${id}`);
      }

      await this.writeConnections(filtered);
      await this.credentials.deleteAll(id);
    });
  }

  /**
   * Get a connection by ID.
   */
  async getById(id: string): Promise<ConnectionConfig | null> {
    const connections = await this.load();
    return connections.find(c => c.id === id) ?? null;
  }

  /**
   * Get all connections.
   */
  async getAll(): Promise<ConnectionConfig[]> {
    return this.load();
  }

  /**
   * Return a copy with credentials loaded from the OS keychain.
   *
   * For password auth a missing password is fatal (unless `requirePassword` is
   * false, used when opening the edit form). For key auth a passphrase is
   * optional, so keychain errors are logged and the key is tried as-is.
   */
  async withCredentials(
    connection: ConnectionConfig,
    options: { requirePassword?: boolean } = {},
  ): Promise<ConnectionConfig> {
    const requirePassword = options.requirePassword ?? true;
    const result: ConnectionConfig = { ...connection };

    try {
      if (connection.authType === 'password' && !result.password) {
        result.password = (await this.credentials.get(connection.id, 'password')) ?? undefined;
        if (!result.password && requirePassword) {
          throw new Error(`No password is stored for "${connection.name}"`);
        }
      }

      if (connection.authType === 'key' && !result.passphrase) {
        result.passphrase = (await this.credentials.get(connection.id, 'passphrase')) ?? undefined;
      }
    } catch (err) {
      if (connection.authType === 'password' && requirePassword) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not read the password from the OS keychain: ${reason}`);
      }
      const reason = err instanceof Error ? err.message : String(err);
      log.warn('Could not read credentials for {id}: {reason}', { id: connection.id, reason });
    }

    return result;
  }

  /** Stage non-empty secrets and return entries that should be deleted after the config write. */
  private async stageSecrets(
    connection: ConnectionConfig,
    fields: SecretFields,
  ): Promise<Array<{ id: string; kind: CredentialKind }>> {
    const toClear: Array<{ id: string; kind: CredentialKind }> = [];

    if (fields.password) {
      if (connection.authType === 'password' && connection.password) {
        await this.credentials.set(connection.id, 'password', connection.password);
      } else {
        toClear.push({ id: connection.id, kind: 'password' });
      }
    }

    if (fields.passphrase) {
      if (connection.authType === 'key' && connection.passphrase) {
        await this.credentials.set(connection.id, 'passphrase', connection.passphrase);
      } else {
        toClear.push({ id: connection.id, kind: 'passphrase' });
      }
    }

    return toClear;
  }

  private async clearSecrets(
    entries: Array<{ id: string; kind: CredentialKind }>,
  ): Promise<void> {
    for (const entry of entries) {
      try {
        await this.credentials.set(entry.id, entry.kind, undefined);
      } catch (err) {
        // The config write already committed; a stale keychain entry is
        // preferable to reporting a failed save that actually succeeded.
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('Could not clear credential {kind} for {id}: {reason}', {
          kind: entry.kind,
          id: entry.id,
          reason,
        });
      }
    }
  }

  /**
   * Capture the current keychain values for the fields an update may change.
   * A read failure is recorded as "unknown" so the rollback never deletes a
   * credential it could not inspect.
   */
  private async snapshotSecrets(
    id: string,
    fields: SecretFields,
  ): Promise<Partial<Record<CredentialKind, string | null>>> {
    const snapshot: Partial<Record<CredentialKind, string | null>> = {};
    for (const kind of ['password', 'passphrase'] as const) {
      if (!fields[kind]) continue;
      try {
        snapshot[kind] = await this.credentials.get(id, kind);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('Could not snapshot credential {kind} for {id}: {reason}', {
          kind,
          id,
          reason,
        });
      }
    }
    return snapshot;
  }

  /** Best-effort rollback of the credentials staged by a failed update. */
  private async restoreSecrets(
    id: string,
    snapshot: Partial<Record<CredentialKind, string | null>>,
  ): Promise<void> {
    for (const kind of ['password', 'passphrase'] as const) {
      if (!(kind in snapshot)) continue;
      try {
        await this.credentials.set(id, kind, snapshot[kind] ?? undefined);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('Could not restore credential {kind} for {id}: {reason}', {
          kind,
          id,
          reason,
        });
      }
    }
  }

  private async writeConnections(connections: ConnectionConfig[]): Promise<void> {
    await this.writeFile(this.configPath, serializeConnections(connections));
  }

  /** Serialize read-modify-write cycles so concurrent saves cannot clobber each other. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.queueDepth += 1;
      try {
        return await task();
      } finally {
        this.queueDepth -= 1;
      }
    };
    const result = this.writeQueue.then(run, run);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
