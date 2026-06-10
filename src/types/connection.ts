export interface ConnectionConfig {
  id: string;           // UUID
  name: string;         // Display name
  host: string;         // Hostname/IP
  port: number;         // Default: 22
  username: string;
  authType: 'key' | 'password';
  privateKeyPath?: string;  // For key auth, e.g. '~/.ssh/id_ed25519'
  password?: string;        // Encrypted, stored only if authType='password'
  createdAt: string;        // ISO date string
  lastConnectedAt?: string; // ISO date string
}
