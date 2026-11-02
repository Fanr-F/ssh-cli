import { describe, expect, test } from 'bun:test';
import type { KeyEvent } from '@opentui/core';
import { matchesKey, normalizeKey } from './matcher';
import type { NormalizedKey } from './types';

function key(overrides: Partial<KeyEvent>): KeyEvent {
  return {
    name: 'a',
    sequence: 'a',
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    ...overrides,
  } as KeyEvent;
}

describe('normalizeKey', () => {
  test('recognizes xterm Alt+arrow sequences without a meta flag', () => {
    const normalized = normalizeKey(key({ name: 'up', sequence: '\x1b[1;3A' }));
    expect(normalized).toEqual<NormalizedKey>({
      name: 'up',
      ctrl: false,
      shift: false,
      meta: true,
      sequence: '\x1b[1;3A',
      printable: false,
    });
  });

  test('marks a plain character as printable', () => {
    expect(normalizeKey(key({ sequence: 'x' })).printable).toBe(true);
  });

  test('does not mark Ctrl/Alt combinations as printable', () => {
    expect(normalizeKey(key({ ctrl: true, sequence: '\x01' })).printable).toBe(false);
    expect(normalizeKey(key({ meta: true, sequence: 'x' })).printable).toBe(false);
  });
});

describe('matchesKey', () => {
  const plainA: NormalizedKey = {
    name: 'a',
    ctrl: false,
    shift: false,
    meta: false,
    sequence: 'a',
    printable: true,
  };

  test('only compares declared modifiers', () => {
    expect(matchesKey(plainA, { name: 'a' })).toBe(true);
    expect(matchesKey(plainA, { name: 'a', ctrl: true })).toBe(false);
  });

  test('supports multiple equivalent patterns', () => {
    expect(matchesKey(plainA, [{ name: 'b' }, { name: 'a' }])).toBe(true);
  });
});
