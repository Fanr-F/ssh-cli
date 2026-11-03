import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createConfirmDialog } from '../../src/ui/confirm-dialog';

function key(name: string, sequence: string, shift = false) {
  return {
    name,
    sequence,
    ctrl: false,
    shift,
    meta: false,
    option: false,
    preventDefault: () => {},
  } as any;
}

const enter = () => key('enter', '\r');
const escape = () => key('escape', '\x1b');
const tab = () => key('tab', '\t');
const shiftTab = () => key('tab', '\t', true);

async function openDialog() {
  const t = await createTestRenderer({ width: 90, height: 24 });
  const results: boolean[] = [];
  const dialog = createConfirmDialog(t.renderer, {
    title: 'Delete connection',
    message: 'Delete "Prod"? This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    onResolve: (confirmed) => results.push(confirmed),
  });
  return { t, dialog, results };
}

describe('confirm dialog', () => {
  test('focuses Cancel by default so Enter is safe', async () => {
    const { t, dialog, results } = await openDialog();
    try {
      await t.renderOnce();
      expect(t.captureCharFrame()).toContain('Delete connection');

      dialog.handleKey(enter());
      dialog.destroy();
      await t.renderOnce();

      expect(results).toEqual([false]);
      expect(t.captureCharFrame()).not.toContain('Delete "Prod"?');
    } finally {
      await t.dispose();
    }
  });

  test('Tab then Enter confirms', async () => {
    const { t, dialog, results } = await openDialog();
    try {
      dialog.handleKey(tab());
      dialog.handleKey(enter());
      await t.renderOnce();

      expect(results).toEqual([true]);
    } finally {
      await t.dispose();
    }
  });

  test('Tab wraps around to Cancel', async () => {
    const { t, dialog, results } = await openDialog();
    try {
      dialog.handleKey(tab());
      dialog.handleKey(tab());
      dialog.handleKey(enter());
      await t.renderOnce();

      expect(results).toEqual([false]);
    } finally {
      await t.dispose();
    }
  });

  test('Shift+Tab moves back to Cancel', async () => {
    const { t, dialog, results } = await openDialog();
    try {
      dialog.handleKey(tab());
      dialog.handleKey(shiftTab());
      dialog.handleKey(enter());
      await t.renderOnce();

      expect(results).toEqual([false]);
    } finally {
      await t.dispose();
    }
  });

  test('Escape cancels and resolves only once', async () => {
    const { t, dialog, results } = await openDialog();
    try {
      dialog.handleKey(escape());
      dialog.handleKey(enter());
      await t.renderOnce();

      expect(results).toEqual([false]);
    } finally {
      await t.dispose();
    }
  });
});
