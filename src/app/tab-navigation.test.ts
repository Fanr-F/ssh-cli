import { describe, expect, test } from 'bun:test';
import { nextTabId, previousTabId, tabIdAt } from './tab-navigation';

describe('tab navigation', () => {
  test('reads ids by index with bounds checks', () => {
    expect(tabIdAt(['a', 'b'], 0)).toBe('a');
    expect(tabIdAt(['a', 'b'], 1)).toBe('b');
    expect(tabIdAt(['a', 'b'], 2)).toBeNull();
    expect(tabIdAt([], 0)).toBeNull();
  });

  test('cycles forward and wraps', () => {
    expect(nextTabId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextTabId(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextTabId(['a', 'b', 'c'], null)).toBe('a');
    expect(nextTabId([], 'a')).toBeNull();
  });

  test('cycles backward and wraps', () => {
    expect(previousTabId(['a', 'b', 'c'], 'c')).toBe('b');
    expect(previousTabId(['a', 'b', 'c'], 'a')).toBe('c');
    expect(previousTabId(['a', 'b', 'c'], null)).toBe('c');
    expect(previousTabId([], null)).toBeNull();
  });
});
