import { describe, expect, test } from 'bun:test';
import {
  applyPasswordKey,
  applyPasswordPaste,
  buildConnectionConfig,
  createFormState,
  createPasswordEdit,
  maskPassword,
  parsePortInput,
  validateForm,
} from '../../src/ui/form-model';

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

  test('parses ports strictly', () => {
    expect(parsePortInput('22')).toBe(22);
    expect(parsePortInput(' 1 ')).toBe(1);
    expect(parsePortInput('65535')).toBe(65535);

    for (const bad of ['0', '65536', '22abc', '22.9', '', '  ', '-1', '1e3', '0x16']) {
      expect(parsePortInput(bad)).toBeNull();
    }
  });

  test('rejects dirty ports instead of truncating them', () => {
    const state = {
      ...createFormState(),
      name: 'box',
      host: 'h',
      port: '22abc',
      username: 'u',
      authType: 'key' as const,
      privateKeyPath: 'k',
    };
    expect(validateForm(state)).toContain('Port must be a number between 1 and 65535');
    expect(buildConnectionConfig(state)).toBeNull();

    state.port = '22.9';
    expect(buildConnectionConfig(state)).toBeNull();

    state.port = '2222';
    expect(buildConnectionConfig(state)?.port).toBe(2222);
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

  test('accepts the space key', () => {
    const edit = applyPasswordKey(
      { password: 'ab', cursor: 2, replaceOnType: false },
      { name: 'space', sequence: ' ' },
    );
    expect(edit.password).toBe('ab ');
    expect(edit.cursor).toBe(3);
  });

  test('rejects control keys that look printable', () => {
    const edit = createPasswordEdit('keep');
    const next = applyPasswordKey(edit, { name: 'a', sequence: '\x01', ctrl: true });
    expect(next).toEqual(edit);
  });
});
