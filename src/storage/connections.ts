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

export class ConnectionStore {
  private migrationChecked = false;
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Load connection metadata. Missing files return an empty list; malformed
   * JSON or invalid entries throw so they cannot be silently overwritten.
   */
  async load(): Promise<ConnectionConfig[]> {
    const filePath = getConfigPath();
    let raw: string | null;
    try {
      raw = await readPrivateFile(filePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not read ${filePath}: ${reason}`);
    }

    if (raw === null) {
      this.migrationChecked = true;
      return [];
    }

    let connections: ConnectionConfig[];
    try {
      connections = parseConnections(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not load ${filePath}: ${reason}`);
    }

    if (!this.migrationChecked) {
      this.migrationChecked = true;
      await this.migrateLegacySecrets(connections);
    }
    return connections;
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
          await setCredential(connection.id, 'password', connection.password);
          count++;
        }
        if (connection.passphrase !== undefined) {
          await setCredential(connection.id, 'passphrase', connection.passphrase);
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
        await deleteConnectionCredentials(newConn.id);
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

      const toClear = await this.stageSecrets(next, fields);
      connections[index] = next;
      await this.writeConnections(connections);
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
      await deleteConnectionCredentials(id);
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
        result.password = (await getCredential(connection.id, 'password')) ?? undefined;
        if (!result.password && requirePassword) {
          throw new Error(`No password is stored for "${connection.name}"`);
        }
      }

      if (connection.authType === 'key' && !result.passphrase) {
        result.passphrase = (await getCredential(connection.id, 'passphrase')) ?? undefined;
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
        await setCredential(connection.id, 'password', connection.password);
      } else {
        toClear.push({ id: connection.id, kind: 'password' });
      }
    }

    if (fields.passphrase) {
      if (connection.authType === 'key' && connection.passphrase) {
        await setCredential(connection.id, 'passphrase', connection.passphrase);
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
        await setCredential(entry.id, entry.kind, undefined);
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

  private async writeConnections(connections: ConnectionConfig[]): Promise<void> {
    await writePrivateFileAtomic(getConfigPath(), serializeConnections(connections));
  }

  /** Serialize read-modify-write cycles so concurrent saves cannot clobber each other. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
