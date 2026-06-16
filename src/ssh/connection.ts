import { Client, ClientChannel, ConnectConfig } from 'ssh2-no-cpu-features';
import { EventEmitter } from 'node:events';
import { ShellOptions, SshConnectionState, AuthenticationError, ConnectionTimeoutError, HostKeyError } from './types';
import { ConnectionConfig } from '../types/connection';
import { buildConnectConfig } from './auth';

interface SshConnectionEvents {
  ready: [];
  close: [];
  error: [error: Error];
  stateChange: [state: SshConnectionState];
}

export class SshConnection extends EventEmitter<SshConnectionEvents> {
  private client: Client;
  private _state: SshConnectionState = SshConnectionState.Disconnected;
  private shellChannel: ClientChannel | null = null;
  private _lastError: Error | null = null;

  constructor() {
    super();
    this.client = new Client();
    this.setupClientHandlers();
  }

  get state(): SshConnectionState {
    return this._state;
  }

  getLastError(): Error | null {
    return this._lastError;
  }

  private setState(state: SshConnectionState): void {
    this._state = state;
    this.emit('stateChange', state);
  }

  private setupClientHandlers(): void {
    this.client.on('ready', () => {
      this.setState(SshConnectionState.Connected);
      this._lastError = null; // Clear error on successful connection
      this.emit('ready');
    });

    this.client.on('close', () => {
      this.setState(SshConnectionState.Disconnected);
      this.shellChannel = null;
      this.emit('close');
    });

    this.client.on('error', (err: Error) => {
      this._lastError = err; // Track the error
      this.emit('error', err);
    });

    this.client.on('end', () => {
      this.setState(SshConnectionState.Disconnected);
      this.shellChannel = null;
    });
  }

  connect(config: ConnectionConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._state !== SshConnectionState.Disconnected) {
        reject(new Error('Already connected or connecting'));
        return;
      }

      this.setState(SshConnectionState.Connecting);

      // Build config using auth.ts (handles both key and password auth)
      const connectConfig = buildConnectConfig(config) as ConnectConfig;

      // Use explicit algorithms to avoid native dep compatibility issues
      connectConfig.algorithms = {
        kex: [
          'curve25519-sha256',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group-exchange-sha256',
        ],
        serverHostKey: [
          'ssh-ed25519',
          'rsa-sha2-512',
          'rsa-sha2-256',
          'ssh-rsa',
        ],
      };

      // Host key verification (auto-accept for MVP with logging)
      connectConfig.hostVerifier = (key: Buffer) => {
        // In MVP, accept all host keys
        // Log the key fingerprint for potential future use
        // In production, you'd want to cache and verify
        return true;
      };

      // Handle errors during connection
      const onError = (err: Error) => {
        this.cleanup();
        if (err.message?.includes('Authentication') || err.message?.includes('password') || err.message?.includes('auth')) {
          reject(new AuthenticationError(err.message));
        } else if (err.message?.includes('timed out') || err.message?.includes('timeout')) {
          reject(new ConnectionTimeoutError(err.message));
        } else if (err.message?.includes('host key')) {
          reject(new HostKeyError(err.message));
        } else {
          reject(err);
        }
      };

      this.client.once('error', onError);

      this.client.once('ready', () => {
        this.client.removeListener('error', onError);
        resolve();
      });

      this.client.connect(connectConfig);
    });
  }

  startShell(options?: ShellOptions): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      if (this._state !== SshConnectionState.Connected) {
        reject(new Error('Not connected'));
        return;
      }

      const cols = options?.cols ?? 80;
      const rows = options?.rows ?? 24;
      const term = options?.term ?? 'xterm-256color';

      this.client.shell(
        { cols, rows, term },
        (err: Error | undefined, channel: ClientChannel) => {
          if (err) {
            reject(err);
            return;
          }
          this.shellChannel = channel;
          resolve(channel);
        }
      );
    });
  }

  resizePty(cols: number, rows: number): void {
    if (this.shellChannel) {
      this.shellChannel.setWindow(rows, cols, 0, 0);
    }
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this._state === SshConnectionState.Disconnected) {
        resolve();
        return;
      }

      this.setState(SshConnectionState.Closing);

      const onClose = () => {
        resolve();
      };

      this.client.once('close', onClose);

      if (this.shellChannel) {
        this.shellChannel.close();
        this.shellChannel = null;
      }
      this.client.end();
    });
  }

  isConnected(): boolean {
    return this._state === SshConnectionState.Connected;
  }

  writeToShell(data: string): void {
    if (this.shellChannel) {
      this.shellChannel.write(data);
    }
  }

  private cleanup(): void {
    this.shellChannel = null;
    this.setState(SshConnectionState.Disconnected);
    try { this.client.end(); } catch (err) {
      // Ignore errors during cleanup — client may already be closed
    }
  }
}
