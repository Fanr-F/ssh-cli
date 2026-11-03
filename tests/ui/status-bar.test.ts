import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createStatusBar } from '../../src/ui/status-bar';

describe('createStatusBar', () => {
  test('renders status messages on the single status line', async () => {
    const t = await createTestRenderer({ width: 60, height: 10 });
    try {
      const bar = createStatusBar(t.renderer);
      t.renderer.root.add(bar.component);
      await t.renderOnce();

      bar.setStatus('hello status', 'error');
      await t.renderOnce();

      expect(t.captureCharFrame()).toContain('hello status');
    } finally {
      await t.dispose();
    }
  });
});
