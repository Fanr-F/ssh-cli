import { describe, expect, test } from 'bun:test';
import { redactSensitive } from './logger';

describe('redactSensitive', () => {
  test('masks common key/value secrets', () => {
    expect(redactSensitive('password=hunter2')).toBe('password=***');
    expect(redactSensitive('PASSWORD: hunter2')).toBe('PASSWORD: ***');
    expect(redactSensitive('token=abc123')).toBe('token=***');
    expect(redactSensitive('api_key = sk-test')).toBe('api_key = ***');
  });

  test('masks sshpass and bearer tokens', () => {
    expect(redactSensitive('sshpass -p hunter2 ssh host')).toBe('sshpass -p *** ssh host');
    expect(redactSensitive('Authorization: Bearer abc.def')).toBe('Authorization: Bearer ***');
  });

  test('leaves ordinary terminal output alone', () => {
    expect(redactSensitive('$ ls -la\nsrc  package.json')).toBe('$ ls -la\nsrc  package.json');
  });
});
