import type { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2-no-cpu-features';
import { EventEmitter } from 'node:events';
import { ShellOptions, SshConnectionState, AuthenticationError, ConnectionTimeoutError, HostKeyError } from './types';
import { ConnectionConfig } from '../types/connection';
import { buildConnectConfig } from './auth';
import { KnownHostsStore } from './known-hosts';
import { createLogger } from '../logger';

const log = createLogger('ssh');

/** Never let a stuck transport keep a tab in "closing" forever. */
const DISCONNECT_TIMEOUT_MS = 5000;

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
  private disconnectPromise: Promise<void> | null = null;

  constructor(private readonly disconnectTimeoutMs: number = DISCONNECT_TIMEOUT_MS) {
    super();
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

  private setupClientHandlers(client: Client): void {
    client.on('ready', () => {
      if (this.client !== client) return;
      log.info('SSH connection ready');
      this.setState(SshConnectionState.Connected);
      this._lastError = null; // Clear error on successful connection
      this.emit('ready');
    });

    client.on('close', () => {
      // Ignore delayed events from a client that has already been replaced
      // or torn down: they must not reset the state of a newer connection.
      if (this.client !== client) return;
      log.info('SSH connection closed');
      this.shellChannel = null;
      this.client = null;
      this.setState(SshConnectionState.Disconnected);
      this.emit('close');
    });

    client.on('error', (err: Error) => {
      if (this.client !== client) return;
      log.error('SSH connection error: {error}', { error: err.message });
      this._lastError = err; // Track the error
      // EventEmitter throws ERR_UNHANDLED_ERROR when no listener is attached.
      // Callers (e.g. the SFTP tab) may not subscribe, so only emit when safe;
      // the error is always available through getLastError().
      if (this.listenerCount('error') > 0) this.emit('error', err);
    });

    client.on('end', () => {
      if (this.client !== client) return;
      log.debug('SSH connection ended');
      // Keep `this.client` so a later disconnect() can still destroy the
      // half-closed transport; the `close` handler (or disconnect) clears it.
      this.shellChannel = null;
      this.setState(SshConnectionState.Disconnected);
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

      // Build config using auth.ts (handles both key and password auth).
      // Reading the key is async so the render loop is not blocked.
      const connectConfig = await buildConnectConfig(config) as ConnectConfig;

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

      // Trust on first use: pin a new host key, reject a changed one.
      const knownHosts = new KnownHostsStore();
      let hostKeyFailure: HostKeyError | null = null;

      connectConfig.hostVerifier = (key: Buffer, verify?: (valid: boolean) => void) => {
        const done = verify ?? (() => {});
        void knownHosts.verify(config.host, config.port, key)
          .then((result) => {
            if (result.ok) {
              if (result.status === 'new') {
                log.warn('Pinned new host key for {host}:{port}: {fingerprint}', {
                  host: config.host,
                  port: config.port,
                  fingerprint: result.fingerprint,
                });
              } else {
                log.debug('Host key verified for {host}:{port}: {fingerprint}', {
                  host: config.host,
                  port: config.port,
                  fingerprint: result.fingerprint,
                });
              }
              done(true);
              return;
            }

            hostKeyFailure = new HostKeyError(result.message);
            log.error('Host key verification failed for {host}:{port}: {reason}', {
              host: config.host,
              port: config.port,
              reason: result.message,
            });
            done(false);
          })
          .catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            hostKeyFailure = new HostKeyError(`Host key verification failed: ${reason}`);
            log.error('Host key verification error for {host}:{port}: {reason}', {
              host: config.host,
              port: config.port,
              reason,
            });
            done(false);
          });
      };

      await new Promise<void>((resolve, reject) => {
        // Handle errors during connection
        const onError = (err: Error) => {
          if (hostKeyFailure) {
            reject(hostKeyFailure);
          } else if (err.message?.includes('Authentication') || err.message?.includes('password') || err.message?.includes('auth')) {
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
    if (this.disconnectPromise) return this.disconnectPromise;

    const client = this.client;
    if (!client) {
      this.setState(SshConnectionState.Disconnected);
      return Promise.resolve();
    }

    // A client kept around after its `end` event (state already Disconnected)
    // must still be destroyed: skipping it would leak the transport.
    this.setState(SshConnectionState.Closing);

    this.disconnectPromise = new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (timedOut: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        client.removeListener('close', onClose);
        if (timedOut) {
          log.warn('SSH disconnect timed out after {timeout}ms', { timeout: this.disconnectTimeoutMs });
        }
        this.shellChannel = null;
        if (this.client === client) this.client = null;
        this.setState(SshConnectionState.Disconnected);
        resolve();
      };

      const onClose = (): void => {
        // The client's own `close` handler runs first and clears
        // `this.client`; only a *different* live client means this event
        // belongs to a stale transport that must not settle the promise.
        if (this.client !== null && this.client !== client) return;
        finish(false);
      };

      client.once('close', onClose);
      timer = setTimeout(() => {
        // Best effort: the transport may already be half-closed. `destroy()`
        // (unlike `end()`) guarantees the underlying socket is released.
        try {
          if (typeof client.destroy === 'function') client.destroy();
          else client.end();
        } catch {
          try { client.end(); } catch {}
        }
        finish(true);
      }, this.disconnectTimeoutMs);
      (timer as { unref?: () => void }).unref?.();

      try {
        if (this.shellChannel) {
          this.shellChannel.close();
          this.shellChannel = null;
        }
        client.end();
      } catch (err) {
        log.warn('SSH disconnect failed: {error}', { error: String(err) });
        finish(false);
      }
    }).finally(() => {
      this.disconnectPromise = null;
    });

    return this.disconnectPromise;
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
