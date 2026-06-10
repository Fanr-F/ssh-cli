import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ConnectionConfig } from '../types/connection';
import { encrypt, decrypt } from './encryption';
import { getConfigPath, ensureConfigDir, configExists } from './config';

export class ConnectionStore {
  private masterPassword: string;

  constructor(masterPassword: string) {
    this.masterPassword = masterPassword;
  }

  /**
   * Load all connections from the encrypted config file.
   * Returns empty array if file doesn't exist.
   * Throws if decryption fails (wrong password).
   */
  async load(): Promise<ConnectionConfig[]> {
    if (!(await configExists())) {
      return [];
    }

    const filePath = getConfigPath();
    const encryptedData = await fs.readFile(filePath, 'utf-8');

    try {
      const decrypted = decrypt(encryptedData, this.masterPassword);
      const connections: ConnectionConfig[] = JSON.parse(decrypted);
      return connections;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unsupported state')) {
        throw new Error('Failed to decrypt config: wrong master password');
      }
      throw new Error(`Failed to decrypt config: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  /**
   * Save connections to the encrypted config file.
   */
  async save(connections: ConnectionConfig[]): Promise<void> {
    await ensureConfigDir();

    // Strip password field from key-based auth connections
    const cleaned = connections.map(conn => {
      if (conn.authType === 'key') {
        const { password, ...rest } = conn;
        return rest as ConnectionConfig;
      }
      return conn;
    });

    const plaintext = JSON.stringify(cleaned, null, 2);
    const encryptedData = encrypt(plaintext, this.masterPassword);

    await fs.writeFile(getConfigPath(), encryptedData, 'utf-8');
  }

  /**
   * Add a new connection. Generates UUID if id is missing.
   */
  async add(connection: ConnectionConfig): Promise<void> {
    const connections = await this.load();

    const newConn = {
      ...connection,
      id: connection.id || crypto.randomUUID(),
      createdAt: connection.createdAt || new Date().toISOString(),
    };

    connections.push(newConn);
    await this.save(connections);
  }

  /**
   * Update an existing connection by ID.
   */
  async update(id: string, updates: Partial<ConnectionConfig>): Promise<void> {
    const connections = await this.load();
    const index = connections.findIndex(c => c.id === id);

    if (index === -1) {
      throw new Error(`Connection not found: ${id}`);
    }

    connections[index] = { ...connections[index], ...updates, id };
    await this.save(connections);
  }

  /**
   * Remove a connection by ID.
   */
  async remove(id: string): Promise<void> {
    const connections = await this.load();
    const filtered = connections.filter(c => c.id !== id);

    if (filtered.length === connections.length) {
      throw new Error(`Connection not found: ${id}`);
    }

    await this.save(filtered);
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
}
