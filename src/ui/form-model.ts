import type { ConnectionConfig } from '../types/connection';

export type FormAuthType = 'key' | 'password';

/** Mutable values backing the connection form fields. */
export interface FormState {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: FormAuthType;
  privateKeyPath: string;
  passphrase: string;
  password: string;
}

export function createFormState(existing?: ConnectionConfig): FormState {
  return {
    name: existing?.name ?? '',
    host: existing?.host ?? '',
    port: existing?.port?.toString() ?? '22',
    username: existing?.username ?? '',
    authType: existing?.authType ?? 'key',
    privateKeyPath: existing?.privateKeyPath ?? '~/.ssh/id_ed25519',
    passphrase: existing?.passphrase ?? '',
    password: existing?.password ?? '',
  };
}

/** Parse a port field strictly: digits only, integer, 1-65535. */
export function parsePortInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/** Returns human-readable validation errors; empty means valid. */
export function validateForm(state: FormState): string[] {
  const errors: string[] = [];
  if (!state.name.trim()) errors.push('Name is required');
  if (!state.host.trim()) errors.push('Host is required');
  if (parsePortInput(state.port) === null) {
    errors.push('Port must be a number between 1 and 65535');
  }
  if (!state.username.trim()) errors.push('Username is required');
  if (state.authType === 'password' && !state.password) {
    errors.push('Password is required when auth type is Password');
  }
  return errors;
}

/** Build a ConnectionConfig, or null when the form is invalid. */
export function buildConnectionConfig(
  state: FormState,
  existing?: ConnectionConfig,
): ConnectionConfig | null {
  if (validateForm(state).length > 0) return null;
  const portNum = parsePortInput(state.port);
  if (portNum === null) return null;

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: state.name.trim(),
    host: state.host.trim(),
    port: portNum,
    username: state.username.trim(),
    authType: state.authType,
    privateKeyPath: state.authType === 'key'
      ? (state.privateKeyPath || '~/.ssh/id_ed25519')
      : undefined,
    passphrase: state.authType === 'key' ? (state.passphrase || undefined) : undefined,
    password: state.authType === 'password' ? state.password : undefined,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastConnectedAt: existing?.lastConnectedAt,
  };
}

export function maskPassword(password: string): string {
  return password ? '•'.repeat(password.length) : ' ';
}

// ── Hand-written password field state ─────────────────────────
// InputRenderable has no mask support, so the password field keeps its own
// tiny edit buffer. All transitions are pure and covered by unit tests.

export interface PasswordEdit {
  password: string;
  cursor: number;
  /** First keystroke after focusing replaces the existing value. */
  replaceOnType: boolean;
}

export interface PasswordKeyInput {
  name: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  option?: boolean;
}

export function createPasswordEdit(password = ''): PasswordEdit {
  return { password, cursor: password.length, replaceOnType: true };
}

export function isPrintablePasswordKey(key: PasswordKeyInput): boolean {
  if (!key.sequence || key.ctrl || key.meta || key.option) return false;
  // OpenTUI reports the space bar as `name: 'space'` (sequence ' ').
  const printableName = key.name === 'space' || key.name.length === 1;
  if (!printableName) return false;
  // Reject control characters that still carry a single-char sequence.
  return !/^[\x00-\x1f\x7f]/.test(key.sequence);
}

/** Apply a key press to the password buffer without mutating the input. */
export function applyPasswordKey(edit: PasswordEdit, key: PasswordKeyInput): PasswordEdit {
  const next = { ...edit };

  if (key.name === 'left') {
    next.replaceOnType = false;
    next.cursor = Math.max(0, next.cursor - 1);
  } else if (key.name === 'right') {
    next.replaceOnType = false;
    next.cursor = Math.min(next.password.length, next.cursor + 1);
  } else if (key.name === 'home') {
    next.replaceOnType = false;
    next.cursor = 0;
  } else if (key.name === 'end') {
    next.replaceOnType = false;
    next.cursor = next.password.length;
  } else if (key.name === 'backspace') {
    if (next.replaceOnType) {
      next.password = '';
      next.cursor = 0;
    } else if (next.cursor > 0) {
      next.password =
        next.password.slice(0, next.cursor - 1) + next.password.slice(next.cursor);
      next.cursor -= 1;
    }
    next.replaceOnType = false;
  } else if (key.name === 'delete') {
    if (!next.replaceOnType && next.cursor < next.password.length) {
      next.password =
        next.password.slice(0, next.cursor) + next.password.slice(next.cursor + 1);
    }
    next.replaceOnType = false;
  } else if (isPrintablePasswordKey(key)) {
    const char = key.sequence ?? '';
    if (next.replaceOnType) {
      next.password = char;
      next.cursor = char.length;
    } else {
      next.password =
        next.password.slice(0, next.cursor) + char + next.password.slice(next.cursor);
      next.cursor += char.length;
    }
    next.replaceOnType = false;
  }

  return next;
}

/** Apply pasted text (newlines removed) to the password buffer. */
export function applyPasswordPaste(edit: PasswordEdit, text: string): PasswordEdit {
  const clean = text.replace(/[\n\r]/g, '');
  if (!clean) return edit;

  const next = { ...edit };
  if (next.replaceOnType) {
    next.password = '';
    next.cursor = 0;
    next.replaceOnType = false;
  }
  next.password =
    next.password.slice(0, next.cursor) + clean + next.password.slice(next.cursor);
  next.cursor += clean.length;
  return next;
}
