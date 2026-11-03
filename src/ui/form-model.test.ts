import { describe, expect, test } from 'bun:test';
import {
  applyPasswordKey,
  applyPasswordPaste,
  buildConnectionConfig,
  createFormState,
  createPasswordEdit,
  maskPassword,
  validateForm,
} from './form-model';

describe('form model', () => {
  test('creates defaults for a new connection', () => {
    const state = createFormState();
    expect(state).toEqual({
      name: '',
      host: '',
      port: '22',
      username: '',
      authType: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
      passphrase: '',
      password: '',
    });
  });

  test('hydrates an existing connection without dropping secrets', () => {
    const state = createFormState({
      id: 'c1',
      name: 'Prod',
      host: 'example.com',
      port: 2222,
      username: 'root',
      authType: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
      passphrase: 'secret',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(state.port).toBe('2222');
    expect(state.passphrase).toBe('secret');
  });

  test('validates required fields, port range and password auth', () => {
    const state = createFormState();
    expect(validateForm(state)).toEqual([
      'Name is required',
      'Host is required',
      'Username is required',
    ]);

    Object.assign(state, {
      name: 'box',
      host: 'h',
      username: 'u',
      port: '70000',
      authType: 'password' as const,
    });
    expect(validateForm(state)).toEqual([
      'Port must be a number between 1 and 65535',
      'Password is required when auth type is Password',
    ]);
  });

  test('builds a trimmed config and keeps the existing id/timestamps', () => {
    const existing = {
      id: 'c1',
      name: 'Old',
      host: 'old.example.com',
      port: 22,
      username: 'root',
      authType: 'key' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastConnectedAt: '2026-02-01T00:00:00.000Z',
    };
    const state = createFormState(existing);
    Object.assign(state, {
      name: '  New  ',
      host: ' new.example.com ',
      username: ' admin ',
      authType: 'password' as const,
      password: 'pw',
    });

    const config = buildConnectionConfig(state, existing);
    expect(config).toEqual({
      id: 'c1',
      name: 'New',
      host: 'new.example.com',
      port: 22,
      username: 'admin',
      authType: 'password',
      privateKeyPath: undefined,
      passphrase: undefined,
      password: 'pw',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastConnectedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  test('rejects invalid state when building a config', () => {
    expect(buildConnectionConfig(createFormState())).toBeNull();
  });

  test('masks passwords using one bullet per character', () => {
    expect(maskPassword('abc')).toBe('•••');
    expect(maskPassword('')).toBe(' ');
  });
});

describe('password field model', () => {
  test('the first character replaces the existing value', () => {
    const edit = createPasswordEdit('old');
    const next = applyPasswordKey(edit, { name: 'x', sequence: 'x' });
    expect(next).toEqual({ password: 'x', cursor: 1, replaceOnType: false });
  });

  test('moves the cursor and inserts at its position', () => {
    let edit = createPasswordEdit('abc');
    edit = applyPasswordKey(edit, { name: 'left' });
    edit = applyPasswordKey(edit, { name: 'left' });
    edit = applyPasswordKey(edit, { name: 'X', sequence: 'X' });
    expect(edit.password).toBe('aXbc');
    expect(edit.cursor).toBe(2);
  });

  test('backspace at the first keystroke clears the whole value', () => {
    const edit = applyPasswordKey(createPasswordEdit('secret'), { name: 'backspace' });
    expect(edit.password).toBe('');
    expect(edit.cursor).toBe(0);
    expect(edit.replaceOnType).toBe(false);
  });

  test('delete removes the character under the cursor', () => {
    let edit = createPasswordEdit('abc');
    edit = applyPasswordKey(edit, { name: 'home' });
    edit = applyPasswordKey(edit, { name: 'delete' });
    expect(edit.password).toBe('bc');
    expect(edit.cursor).toBe(0);
  });

  test('paste strips newlines and replaces on first input', () => {
    const edit = applyPasswordPaste(createPasswordEdit('old'), 'a\r\nb\n');
    expect(edit.password).toBe('ab');
    expect(edit.cursor).toBe(2);
    expect(edit.replaceOnType).toBe(false);
  });

  test('pasting only newlines is a no-op', () => {
    const edit = createPasswordEdit('keep');
    expect(applyPasswordPaste(edit, '\r\n')).toBe(edit);
  });
});
