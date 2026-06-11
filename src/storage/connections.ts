import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ConnectionConfig } from '../types/connection';
import { getConfigPath, ensureConfigDir } from './config';

export class ConnectionStore {
  /**
   * Load all connections from the config file.
   * Returns empty array if file doesn't exist.
   */
  async load(): Promise<ConnectionConfig[]> {
    try {
      const filePath = getConfigPath();
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as ConnectionConfig[];
    } catch {
      return [];
    }
  }

  /**
   * Save connections to the config file.
   */
  async save(connections: ConnectionConfig[]): Promise<void> {
    await ensureConfigDir();
    await fs.writeFile(getConfigPath(), JSON.stringify(connections, null, 2), 'utf-8');
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
