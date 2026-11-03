import { describe, expect, test } from 'bun:test';
import { resolveForwardMouse } from '../../src/app/terminal-tab';

describe('resolveForwardMouse', () => {
  test('returns null when the private method is gone', () => {
    expect(resolveForwardMouse({})).toBeNull();
    expect(resolveForwardMouse({ forwardMouse: 'nope' })).toBeNull();
  });

  test('binds the method to the terminal and forwards arguments', () => {
    const calls: Array<[unknown, string]> = [];
    const term = {
      forwardMouse(event: unknown, action: string) {
        calls.push([event, action]);
      },
    };

    const forward = resolveForwardMouse(term);
    expect(forward).not.toBeNull();

    const event = { x: 1, y: 2 };
    forward?.(event, 'press');
    forward?.(event, 'release');

    expect(calls).toEqual([[event, 'press'], [event, 'release']]);
  });
});
