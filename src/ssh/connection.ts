import type { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2-no-cpu-features';
import { EventEmitter } from 'node:events';
import { ShellOptions, SshConnectionState, AuthenticationError, ConnectionTimeoutError, HostKeyError } from './types';
import { ConnectionConfig } from '../types/connection';
import { buildConnectConfig } from './auth';
import { createLogger } from '../logger';

const log = createLogger('ssh');

interface SshConnectionEvents {
  ready: [];
  close: [];
  error: [error: Error];
  stateChange: [state: SshConnectionState];
}

export class SshConnection extends EventEmitter<SshConnectionEvents> {
  // ssh2 is loaded lazily on the first `connect()` call: importing it eagerly
  // costs ~20 MB RSS at startup, which matters for a TUI that starts offline.
  private client: Client | null = null;
  private _state: SshConnectionState = SshConnectionState.Disconnected;
  private shellChannel: ClientChannel | null = null;
  private _lastError: Error | null = null;

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

  private setupClientHandlers(client: Client): void {
    client.on('ready', () => {
      log.info('SSH connection ready');
      this.setState(SshConnectionState.Connected);
      this._lastError = null; // Clear error on successful connection
      this.emit('ready');
    });

    client.on('close', () => {
      log.info('SSH connection closed');
      this.setState(SshConnectionState.Disconnected);
      this.shellChannel = null;
      if (this.client === client) this.client = null;
      this.emit('close');
    });

    client.on('error', (err: Error) => {
      log.error('SSH connection error: {error}', { error: err.message });
      this._lastError = err; // Track the error
      this.emit('error', err);
    });

    client.on('end', () => {
      log.debug('SSH connection ended');
      this.setState(SshConnectionState.Disconnected);
      this.shellChannel = null;
    });
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (this._state !== SshConnectionState.Disconnected) {
      throw new Error('Already connected or connecting');
    }

    log.info('Connecting to SSH server: {host}:{port} as {username}', {
      host: config.host,
      port: config.port,
      username: config.username,
    });
    this.setState(SshConnectionState.Connecting);

    try {
      // Lazy-load the heavy SSH implementation only when actually connecting.
      const { Client } = await import('ssh2-no-cpu-features');
      const client = new Client();
      this.client = client;
      this.setupClientHandlers(client);

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

      await new Promise<void>((resolve, reject) => {
        // Handle errors during connection
        const onError = (err: Error) => {
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

        client.once('error', onError);

        client.once('ready', () => {
          client.removeListener('error', onError);
          resolve();
        });

        client.connect(connectConfig);
      });
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  startShell(options?: ShellOptions): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const client = this.client;
      if (this._state !== SshConnectionState.Connected || !client) {
        reject(new Error('Not connected'));
        return;
      }

      const cols = options?.cols ?? 80;
      const rows = options?.rows ?? 24;
      const term = options?.term ?? 'xterm-256color';

      client.shell(
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
      const client = this.client;
      if (this._state === SshConnectionState.Disconnected || !client) {
        this.setState(SshConnectionState.Disconnected);
        resolve();
        return;
      }

      this.setState(SshConnectionState.Closing);

      const onClose = () => {
        resolve();
      };

      client.once('close', onClose);

      if (this.shellChannel) {
        this.shellChannel.close();
        this.shellChannel = null;
      }
      client.end();
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

  /** Open an SFTP session over the existing SSH connection. */
  startSftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      const client = this.client;
      if (this._state !== SshConnectionState.Connected || !client) {
        reject(new Error('Not connected'));
        return;
      }

      client.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(sftp);
      });
    });
  }

  /** Get the remote working directory by executing `echo $PWD`. */
  async getRemotePwd(): Promise<string> {
    const channel = await this.startShell({ cols: 80, rows: 1 });
    return new Promise<string>((resolve, reject) => {
      let output = '';
      const onData = (data: Buffer) => {
        output += data.toString();
      };
      const onClose = () => {
        channel.removeListener('data', onData);
        const match = output.match(/\/[^\s]*/);
        resolve(match ? match[0] : '/');
      };
      channel.on('data', onData);
      channel.once('close', onClose);
      channel.write('echo $PWD\n');
    });
  }

  private cleanup(): void {
    this.shellChannel = null;
    this.setState(SshConnectionState.Disconnected);
    const client = this.client;
    this.client = null;
    try { client?.end(); } catch (err) {
      // Ignore errors during cleanup — client may already be closed
    }
  }
}
