import type { ConnectionConfig } from '../types/connection';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid connection at index ${index}: "${key}" must be a non-empty string`);
  }
  return value;
}

function optionalString(record: UnknownRecord, key: string, index: number): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid connection at index ${index}: "${key}" must be a string`);
  }
  return value;
}

function optionalSecret(record: UnknownRecord, key: string, index: number): string | undefined {
  const value = optionalString(record, key, index);
  return value ? value : undefined;
}

function parseConnection(value: unknown, index: number): ConnectionConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid connection at index ${index}: expected an object`);
  }

  const portValue = value.port;
  const port = typeof portValue === 'number' ? portValue : Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid connection at index ${index}: "port" must be an integer between 1 and 65535`);
  }

  const authType = value.authType;
  if (authType !== 'key' && authType !== 'password') {
    throw new Error(`Invalid connection at index ${index}: "authType" must be "key" or "password"`);
  }

  return {
    id: requiredString(value, 'id', index),
    name: requiredString(value, 'name', index),
    host: requiredString(value, 'host', index),
    port,
    username: requiredString(value, 'username', index),
    authType,
    privateKeyPath: optionalString(value, 'privateKeyPath', index),
    passphrase: optionalSecret(value, 'passphrase', index),
    password: optionalSecret(value, 'password', index),
    createdAt: optionalString(value, 'createdAt', index) ?? new Date(0).toISOString(),
    lastConnectedAt: optionalString(value, 'lastConnectedAt', index),
  };
}

/**
 * Parse and validate the JSON config. Unlike the previous implementation this
 * throws on malformed data instead of returning an empty list, so a corrupted
 * file cannot be silently overwritten with an empty one.
 */
export function parseConnections(raw: string): ConnectionConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Connection config is not valid JSON: ${reason}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Connection config must be a JSON array');
  }

  return parsed.map((entry, index) => parseConnection(entry, index));
}

/** Remove credentials before writing metadata to disk. */
export function stripSecrets(connection: ConnectionConfig): ConnectionConfig {
  return {
    ...connection,
    password: undefined,
    passphrase: undefined,
  };
}

/** Serialize connections without ever writing passwords/passphrases. */
export function serializeConnections(connections: ConnectionConfig[]): string {
  return JSON.stringify(connections.map(stripSecrets), null, 2);
}

export function hasStoredSecrets(connection: ConnectionConfig): boolean {
  return connection.password !== undefined || connection.passphrase !== undefined;
}

export function hasOwnSecret(connection: ConnectionConfig, key: 'password' | 'passphrase'): boolean {
  return Object.prototype.hasOwnProperty.call(connection, key) && connection[key] !== undefined;
}
