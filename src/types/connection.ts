export interface ConnectionConfig {
  id: string;           // UUID
  name: string;         // Display name
  host: string;         // Hostname/IP
  port: number;         // Default: 22
  username: string;
  authType: 'key' | 'password';
  privateKeyPath?: string;  // For key auth, e.g. '~/.ssh/id_ed25519'
  passphrase?: string;      // Optional passphrase for an encrypted private key
  password?: string;        // Stored only if authType='password'; plaintext until keychain migration
  createdAt: string;        // ISO date string
  lastConnectedAt?: string; // ISO date string
}
