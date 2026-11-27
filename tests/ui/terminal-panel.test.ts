import { describe, expect, test } from 'bun:test';
import { EmbeddedTerminalRenderable } from '@opentui/core';
import type { CliRenderer, Selection } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createTerminalPanel } from '../../src/ui/terminal-panel';

async function setup() {
  const t = await createTestRenderer({ width: 60, height: 20 });
  const panel = createTerminalPanel(t.renderer);
  t.renderer.root.add(panel.component);
  await t.renderOnce();

  const termA = new EmbeddedTerminalRenderable(t.renderer as any, {
    cols: 60,
    rows: 19,
    maxScrollback: 200,
  });
  const termB = new EmbeddedTerminalRenderable(t.renderer as any, {
    cols: 60,
    rows: 19,
    maxScrollback: 200,
  });
  panel.registerTerminal('a', termA);
  panel.registerTerminal('b', termB);
  return { t, panel, termA, termB };
}

function dragSelect(
  renderer: CliRenderer,
  term: EmbeddedTerminalRenderable,
  startX: number,
  endX: number,
  y: number,
): Selection | null {
  renderer.startSelection(term, startX, y, 'cell');
  renderer.updateSelection(term, endX, y, { finishDragging: true });
  return renderer.getSelection();
}

describe('terminal panel tab visibility', () => {
  test('only the active tab is selectable and part of the selection', async () => {
    const { t, panel, termA, termB } = await setup();
    try {
      panel.switchTerminal('a');
      expect(termA.selectable).toBe(true);
      expect(termB.selectable).toBe(false);

      termA.write('leaked first-session text\r\n');
      termB.write('mysql84-community-release-el7-2.noarch.rpm\r\n');

      panel.switchTerminal('b');
      expect(termA.selectable).toBe(false);
      expect(termB.selectable).toBe(true);
      await t.renderOnce();

      const selection = dragSelect(
        t.renderer,
        termB,
        termB.x,
        termB.x + 20,
        termB.y,
      );
      expect(selection).not.toBeNull();
      // The hidden tab keeps its last layout rectangle, so without the fix it
      // would be merged into this selection too.
      expect(selection!.selectedRenderables).toEqual([termB]);
      expect(selection!.getSelectedText()).toContain('mysql84');
      expect(selection!.getSelectedText()).not.toContain('leaked');
    } finally {
      await t.dispose();
    }
  });

  test('clears the selection of a tab that goes to the background', async () => {
    const { t, panel, termA, termB } = await setup();
    try {
      panel.switchTerminal('a');
      const cleared: Array<Selection | null> = [];
      const original = termA.onSelectionChanged.bind(termA);
      termA.hasSelection = () => true;
      termA.onSelectionChanged = (selection) => {
        if (selection === null) cleared.push(selection);
        return original(selection);
      };

      panel.switchTerminal('b');
      expect(cleared.length).toBe(1);
      expect(termA.selectable).toBe(false);
      expect(termB.selectable).toBe(true);
    } finally {
      await t.dispose();
    }
  });

  test('hiding the panel (SFTP tab) also disables selection', async () => {
    const { t, panel, termA } = await setup();
    try {
      panel.switchTerminal('a');
      expect(termA.selectable).toBe(true);

      panel.setVisible(false);
      expect(termA.selectable).toBe(false);

      panel.setVisible(true);
      expect(termA.selectable).toBe(true);
    } finally {
      await t.dispose();
    }
  });
});
