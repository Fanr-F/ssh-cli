import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { bindingShortcut, createToolbar } from '../../src/ui/toolbar';
import { BINDINGS, formatKeys } from '../../src/keymap';

describe('toolbar shortcut labels', () => {
  test('derive every hint from the binding table', () => {
    const mapping: Array<[string, string]> = [
      ['sidebar.add', 'A'],
      ['sidebar.edit', 'E'],
      ['sidebar.connect', 'Enter'],
      ['sidebar.delete', 'Delete'],
      ['app.quit', 'Ctrl+Q'],
      ['help.toggle', 'F1'],
    ];

    for (const [id, expected] of mapping) {
      const binding = BINDINGS.find((entry) => entry.id === id);
      expect(binding).toBeDefined();
      expect(bindingShortcut(id)).toBe(expected);
      expect(formatKeys(binding!.key, binding!.keys)).toBe(expected);
    }
  });

  test('renders the hints on the toolbar', async () => {
    const t = await createTestRenderer({ width: 120, height: 24 });
    const toolbar = createToolbar(t.renderer, {});
    t.renderer.root.add(toolbar.component);

    try {
      await t.renderOnce();
      const frame = t.captureCharFrame();
      for (const hint of ['new', '[A]', 'edit', '[E]', 'connect', '[Enter]', 'delete', '[Delete]', 'quit', '[Ctrl+Q]', 'help', '[F1]']) {
        expect(frame).toContain(hint);
      }
    } finally {
      await t.dispose();
    }
  });

  test('unknown binding ids are visible instead of crashing', () => {
    expect(bindingShortcut('does.not.exist')).toBe('?');
  });
});
