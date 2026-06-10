export interface ShellOptions {
  cols?: number;  // default 80
  rows?: number;  // default 24
  term?: string;  // default 'xterm-256color'
}

export enum SshConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Closing = 'closing',
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ConnectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionTimeoutError';
  }
}

export class HostKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostKeyError';
  }
}
