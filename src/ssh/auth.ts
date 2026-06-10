import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { utils } from 'ssh2-no-cpu-features';
import { ConnectionConfig } from '../types/connection';

// ssh2 connection config type (we don't import it directly to avoid issues)
interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
  passphrase?: string;
  readyTimeout?: number;
  hostHash?: string;
  hostVerifier?: (key: Buffer) => boolean;
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
    hostHash: 'sha256',
  };

  if (connection.authType === 'key') {
    const keyPath = connection.privateKeyPath || discoverDefaultKey();
    if (keyPath) {
      try {
        const resolvedPath = keyPath.startsWith('~')
          ? path.join(os.homedir(), keyPath.slice(1))
          : keyPath;
        const keyData = fs.readFileSync(resolvedPath);
        const parsedKey = utils.parseKey(keyData);
        if (parsedKey instanceof Error) {
          console.warn(`Warning: Failed to parse key at ${resolvedPath}: ${parsedKey.message}`);
        } else {
          config.privateKey = parsedKey;
        }
      } catch (err) {
        console.warn(`Warning: Could not read key at ${keyPath}`);
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
export function discoverKeys(): string[] {
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
  } catch {
    // .ssh directory might not exist
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

/**
 * Check if an SSH key file is valid.
 */
export async function validateKey(keyPath: string): Promise<boolean> {
  try {
    const resolvedPath = keyPath.startsWith('~')
      ? path.join(os.homedir(), keyPath.slice(1))
      : keyPath;
    const keyData = fs.readFileSync(resolvedPath);
    const parsedKey = utils.parseKey(keyData);
    return !(parsedKey instanceof Error);
  } catch {
    return false;
  }
}
