import { describe, expect, test } from 'bun:test';
import { LOG_LEVELS, parseLogLevel, redactSensitive } from '../src/logger';

describe('parseLogLevel', () => {
  test('defaults to info without the flag', () => {
    expect(parseLogLevel([])).toEqual({ level: 'info' });
  });

  test('accepts every supported level', () => {
    for (const level of LOG_LEVELS) {
      expect(parseLogLevel(['--log-level', level])).toEqual({ level });
    }
  });

  test('falls back to info and warns on unknown or missing values', () => {
    expect(parseLogLevel(['--log-level', 'verbose'])).toEqual({
      level: 'info',
      warning: 'Unknown log level "verbose"; using "info".',
    });
    expect(parseLogLevel(['--log-level']).warning).toContain('Missing value');
  });
});


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
