import { describe, expect, test } from 'bun:test';
import { createAltScreenTracker } from '../../src/ssh/alt-screen';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('alt screen tracker', () => {
  test('tracks the common alternate-screen sequences', () => {
    const tracker = createAltScreenTracker();
    expect(tracker.active).toBe(false);

    tracker.feed(bytes('\x1b[?1049h'));
    expect(tracker.active).toBe(true);

    tracker.feed(bytes('\x1b[?1049l'));
    expect(tracker.active).toBe(false);

    tracker.feed(bytes('\x1b[?47h'));
    expect(tracker.active).toBe(true);

    tracker.feed(bytes('\x1b[?1047l'));
    expect(tracker.active).toBe(false);
  });

  test('handles sequences split across chunks', () => {
    const tracker = createAltScreenTracker();
    tracker.feed(bytes('output\x1b[?10'));
    expect(tracker.active).toBe(false);

    tracker.feed(bytes('49hmore'));
    expect(tracker.active).toBe(true);

    tracker.feed(bytes('\x1b[?1049'));
    tracker.feed(bytes('l'));
    expect(tracker.active).toBe(false);
  });

  test('supports combined private modes such as ESC[?1049;25h', () => {
    const tracker = createAltScreenTracker();
    tracker.feed(bytes('\x1b[?1049;25h'));
    expect(tracker.active).toBe(true);

    tracker.feed(bytes('\x1b[?25;1049l'));
    expect(tracker.active).toBe(false);
  });

  test('ignores cursor-save mode 1048 and unrelated sequences', () => {
    const tracker = createAltScreenTracker();
    tracker.feed(bytes('\x1b[?1048h'));
    expect(tracker.active).toBe(false);

    tracker.feed(bytes('\x1b[?2004h'));
    expect(tracker.active).toBe(false);
  });

  test('uses the last matching sequence in a chunk', () => {
    const tracker = createAltScreenTracker();
    tracker.feed(bytes('\x1b[?1049h then \x1b[?1049l'));
    expect(tracker.active).toBe(false);

    tracker.feed(bytes('\x1b[?1049l then \x1b[?1049h'));
    expect(tracker.active).toBe(true);
  });

  test('reset clears the buffered tail and state', () => {
    const tracker = createAltScreenTracker();
    tracker.feed(bytes('\x1b[?1049h'));
    tracker.feed(bytes('trailing\x1b[?10'));
    tracker.reset();

    expect(tracker.active).toBe(false);
    // A stale tail would make this premature chunk switch mode.
    tracker.feed(bytes('49h'));
    expect(tracker.active).toBe(false);
  });
});
