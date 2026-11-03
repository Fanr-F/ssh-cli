import fs from 'node:fs';
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
  readyTimeout?: number;
  hostHash?: string;
  hostVerifier?: (key: Buffer, verify?: (valid: boolean) => void) => boolean | void;
  algorithms?: {
    kex?: string[];
    serverHostKey?: string[];
  };
}

/**
 * Build ssh2 connection config from a ConnectionConfig.
 * If key auth: reads and parses the private key file.
 * If password auth: sets the password field.
 */
export function buildConnectConfig(connection: ConnectionConfig): SshConnectConfig {
  const config: SshConnectConfig = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    readyTimeout: 10000,
  };

  if (connection.authType === 'key') {
    const keyPath = connection.privateKeyPath || discoverDefaultKey();
    if (keyPath) {
      try {
        const resolvedPath = keyPath.startsWith('~')
          ? path.join(os.homedir(), keyPath.slice(1))
          : keyPath;
        const keyData = fs.readFileSync(resolvedPath);
        config.privateKey = keyData;
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
    }
  } else if (connection.authType === 'password' && connection.password) {
    config.password = connection.password;
  }

  return config;
}

/**
 * List available SSH keys from ~/.ssh/ directory.
 * Returns absolute paths to found key files.
 */
function discoverKeys(): string[] {
  const sshDir = path.join(os.homedir(), '.ssh');
  const keyNames = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa', 'id_ecdsa_sk', 'id_ed25519_sk'];
  const found: string[] = [];

  try {
    for (const name of keyNames) {
      const keyPath = path.join(sshDir, name);
      if (fs.existsSync(keyPath)) {
        found.push(keyPath);
      }
    }
  } catch (err) {
    // .ssh directory might not exist — silently ignore
  }

  return found;
}

/**
 * Discover the default SSH key path.
 * Returns the path to the first found key, or '~/.ssh/id_ed25519' as default.
 */
export function discoverDefaultKey(): string {
  const keys = discoverKeys();
  if (keys.length > 0) {
    return keys[0];
  }
  return '~/.ssh/id_ed25519';
}
