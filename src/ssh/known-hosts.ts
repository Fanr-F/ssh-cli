import crypto from 'node:crypto';
import {
  getKnownHostsPath,
  readPrivateFile,
  writePrivateFileAtomic,
} from '../storage/config';
import { createLogger } from '../logger';

const log = createLogger('known-hosts');

/**
 * Refresh `lastSeen` at most once per hour per host. The field is metadata,
 * so rewriting the whole store on every connect (read + atomic write) is not
 * worth the I/O — but leaving it frozen forever makes it dead data.
 */
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

export interface KnownHostEntry {
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
}

export type KnownHostsFile = Record<string, KnownHostEntry>;

export type HostKeyVerification =
  | { ok: true; status: 'trusted' | 'new'; fingerprint: string }
  | {
      ok: false;
      status: 'mismatch' | 'error';
      message: string;
      fingerprint?: string;
      expected?: string;
    };

/** Key used in known_hosts.json; IPv6 hosts are bracketed. */
export function knownHostKeyId(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** OpenSSH-style SHA-256 fingerprint, without base64 padding. */
export function fingerprintHostKey(key: Buffer): string {
  const digest = crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the TOFU store; malformed data fails closed. */
export function parseKnownHosts(raw: string): KnownHostsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Known-hosts file is not valid JSON: ${reason}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Known-hosts file must be a JSON object');
  }

  const result: KnownHostsFile = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!isRecord(value)
      || typeof value.fingerprint !== 'string'
      || typeof value.firstSeen !== 'string'
      || typeof value.lastSeen !== 'string') {
      throw new Error(`Invalid known-hosts entry for ${id}`);
    }
    result[id] = {
      fingerprint: value.fingerprint,
      firstSeen: value.firstSeen,
      lastSeen: value.lastSeen,
    };
  }
  return result;
}

let writeQueue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Trust-on-first-use host key store.
 *
 * A new key is pinned automatically. A changed key is rejected; this is the
 * important protection against a swapped server key after the first connect.
 * The first connection is still vulnerable to an active MITM, which is why
 * the fingerprint is logged and can later be reviewed.
 */
export class KnownHostsStore {
  constructor(private readonly filePath: string = getKnownHostsPath()) {}

  private async load(): Promise<KnownHostsFile> {
    const raw = await readPrivateFile(this.filePath);
    return raw === null ? {} : parseKnownHosts(raw);
  }

  async verify(host: string, port: number, key: Buffer): Promise<HostKeyVerification> {
    const id = knownHostKeyId(host, port);
    const fingerprint = fingerprintHostKey(key);

    return enqueue(async () => {
      let store: KnownHostsFile;
      try {
        store = await this.load();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          status: 'error',
          message: `Could not read ${this.filePath}: ${reason}`,
          fingerprint,
        };
      }

      const existing = store[id];
      if (!existing) {
        const now = new Date().toISOString();
        store[id] = { fingerprint, firstSeen: now, lastSeen: now };
        try {
          await writePrivateFileAtomic(this.filePath, JSON.stringify(store, null, 2));
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            status: 'error',
            message: `Could not save the host key to ${this.filePath}: ${reason}`,
            fingerprint,
          };
        }
        return { ok: true, status: 'new', fingerprint };
      }

      if (existing.fingerprint !== fingerprint) {
        return {
          ok: false,
          status: 'mismatch',
          message:
            `Host key for ${id} changed. Expected ${existing.fingerprint}, got ${fingerprint}. `
            + `If the server was rebuilt intentionally, remove its entry from ${this.filePath}.`,
          fingerprint,
          expected: existing.fingerprint,
        };
      }

      // Trusted key: refresh lastSeen when it is stale, but never fail the
      // connection because metadata could not be written.
      const now = Date.now();
      const lastSeenMs = Date.parse(existing.lastSeen);
      if (!Number.isFinite(lastSeenMs) || now - lastSeenMs >= LAST_SEEN_REFRESH_MS) {
        existing.lastSeen = new Date(now).toISOString();
        try {
          await writePrivateFileAtomic(this.filePath, JSON.stringify(store, null, 2));
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          log.warn('Could not update lastSeen for {id}: {reason}', { id, reason });
        }
      }

      return { ok: true, status: 'trusted', fingerprint };
    });
  }
}
