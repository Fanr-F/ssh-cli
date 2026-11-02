import { describe, expect, test } from 'bun:test';
import { parseConnections, serializeConnections } from './schema';

const validConnection = {
  id: 'conn-1',
  name: 'Example',
  host: 'example.com',
  port: 22,
  username: 'root',
  authType: 'password',
  password: 'hunter2',
  createdAt: '2026-11-02T00:00:00.000Z',
};

describe('parseConnections', () => {
  test('keeps legacy credentials in memory for migration', () => {
    const [connection] = parseConnections(JSON.stringify([validConnection]));
    expect(connection.password).toBe('hunter2');
    expect(connection.port).toBe(22);
  });

  test('accepts numeric strings for legacy ports', () => {
    const [connection] = parseConnections(JSON.stringify([{ ...validConnection, port: '2222' }]));
    expect(connection.port).toBe(2222);
  });

  test('rejects malformed JSON', () => {
    expect(() => parseConnections('{not json')).toThrow('not valid JSON');
  });

  test('rejects a non-array config', () => {
    expect(() => parseConnections('{}')).toThrow('JSON array');
  });

  test('rejects invalid ports', () => {
    expect(() => parseConnections(JSON.stringify([{ ...validConnection, port: 70000 }])))
      .toThrow('port');
  });

  test('rejects missing required fields', () => {
    expect(() => parseConnections(JSON.stringify([{ ...validConnection, name: '' }])))
      .toThrow('name');
  });
});

describe('serializeConnections', () => {
  test('never writes passwords or passphrases', () => {
    const raw = serializeConnections([{
      ...validConnection,
      authType: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
      passphrase: 'key-secret',
    }]);
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('key-secret');
    expect(raw).not.toContain('"password"');
    expect(raw).not.toContain('"passphrase"');
  });
});
