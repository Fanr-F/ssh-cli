import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConnectionConfig } from '../types/connection';
import { createLogger } from '../logger';

const log = createLogger('ssh-auth');

// ssh2 is imported lazily (only when a key actually needs parsing) so that
// merely loading this module does not pull in the whole ssh2 library.
interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
  passphrase?: string;
  agent?: string;
  readyTimeout?: number;
  hostHash?: string;
  hostVerifier?: (key: Buffer, verify?: (valid: boolean) => void) => boolean | void;
  algorithms?: {
    kex?: string[];
    serverHostKey?: string[];
  };
}

/** Optional dependencies so discovery can be tested without touching the real home. */
export interface AuthOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

interface CachedKey {
  mtimeMs: number;
  size: number;
  key: Buffer;
}

/** Private keys are immutable in practice; cache by path + mtime + size. */
const keyCache = new Map<string, CachedKey>();

async function readPrivateKey(resolvedPath: string): Promise<Buffer> {
  const info = await fsp.stat(resolvedPath);
  const cached = keyCache.get(resolvedPath);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.key;
  }
  const key = await fsp.readFile(resolvedPath);
  keyCache.set(resolvedPath, { mtimeMs: info.mtimeMs, size: info.size, key });
  return key;
}

function resolveHomePath(keyPath: string, homeDir: string): string {
  return keyPath.startsWith('~') ? path.join(homeDir, keyPath.slice(1)) : keyPath;
}

/**
 * Build ssh2 connection config from a ConnectionConfig.
 * If key auth: reads and parses the private key file (asynchronously, cached).
 * If password auth: sets the password field.
 */
export async function buildConnectConfig(
  connection: ConnectionConfig,
  options: AuthOptions = {},
): Promise<SshConnectConfig> {
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;

  const config: SshConnectConfig = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    readyTimeout: 10000,
  };

  if (connection.authType === 'key') {
    const keyPath = connection.privateKeyPath || discoverDefaultKey(homeDir);
    if (keyPath) {
      try {
        const resolvedPath = resolveHomePath(keyPath, homeDir);
        config.privateKey = await readPrivateKey(resolvedPath);
        if (connection.passphrase) {
          config.passphrase = connection.passphrase;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('Could not read private key at {path}: {reason}', { path: keyPath, reason });
        // Do not continue with a half-built auth config: the user would only see
        // a misleading "authentication failed" later.
        throw new Error(`Could not read private key at ${keyPath}: ${reason}`);
      }
    } else if (env.SSH_AUTH_SOCK) {
      // No key on disk: let ssh-agent handle authentication.
      config.agent = env.SSH_AUTH_SOCK;
    } else {
      throw new Error(
        'No SSH private key found. Set a key path in the connection or start ssh-agent (SSH_AUTH_SOCK).',
      );
    }
  } else if (connection.authType === 'password' && connection.password) {
    config.password = connection.password;
  }

  return config;
}

/**
 * List available SSH keys from `~/.ssh/`.
 * Returns absolute paths to found key files.
 */
function discoverKeys(homeDir: string): string[] {
  const sshDir = path.join(homeDir, '.ssh');
  const keyNames = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa', 'id_ecdsa_sk', 'id_ed25519_sk'];
  const found: string[] = [];

  try {
    for (const name of keyNames) {
      const keyPath = path.join(sshDir, name);
      if (fs.existsSync(keyPath)) {
        found.push(keyPath);
      }
    }
  } catch {
    // .ssh directory might not exist — silently ignore
  }

  return found;
}

/**
 * Discover the default SSH key path.
 * Returns the first found key, or null when there is no usable key on disk
 * (so callers can fall back to ssh-agent / a clear error instead of a
 * misleading "could not read ~/.ssh/id_ed25519").
 */
export function discoverDefaultKey(homeDir: string = os.homedir()): string | null {
  const keys = discoverKeys(homeDir);
  return keys[0] ?? null;
}
