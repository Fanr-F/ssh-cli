import { describe, expect, test } from 'bun:test';
import { Box } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createSidebar } from '../../src/ui/sidebar';
import type { ConnectionConfig } from '../../src/types/connection';

function connection(id: string, name = id): ConnectionConfig {
  return {
    id,
    name,
    host: `${id}.example.com`,
    port: 22,
    username: 'root',
    authType: 'key',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('sidebar layout', () => {
  test('keeps the vertical scrollbar on the right edge, not below the list', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const connections = Array.from({ length: 20 }, (_, i) => connection(`c${i}`));
    const sidebar = createSidebar(t.renderer, connections);
    // Constrain the height (row + stretch) so the list actually scrolls.
    t.renderer.root.add(
      Box({ width: 30, height: 20, flexDirection: 'row' }, sidebar as any),
    );

    try {
      await t.renderOnce();
      const sb = t.renderer.root.findDescendantById('sidebar') as any;
      expect(sb).toBeTruthy();

      const bar = sb.verticalScrollBar;
      expect(bar.visible).toBe(true);
      expect(bar.screenY).toBe(sb.wrapper.screenY);
      expect(bar.screenX).toBeGreaterThanOrEqual(sb.wrapper.screenX + sb.wrapper.width);
      expect(bar.height).toBe(sb.wrapper.height);
      expect(bar.width).toBeLessThanOrEqual(2);
    } finally {
      await t.dispose();
    }
  });
});

describe('sidebar selection', () => {
  test('keeps the selected connection by id after setConnections', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const a = connection('a');
    const b = connection('b');
    const c = connection('c');
    const sidebar = createSidebar(t.renderer, [a, b, c]);
    t.renderer.root.add(sidebar);

    try {
      await t.renderOnce();
      const selected: string[] = [];
      sidebar.onConnectionSelect((conn) => selected.push(conn.id));

      sidebar.selectNext();
      expect(sidebar.getSelectedConnection()?.id).toBe('b');

      sidebar.setConnections([a, b, c], 'b');
      expect(sidebar.getSelectedConnection()?.id).toBe('b');

      // Without a preferred id the current selection is preserved.
      sidebar.setConnections([a, b, c]);
      expect(sidebar.getSelectedConnection()?.id).toBe('b');

      // A newly created connection becomes the selection.
      sidebar.setConnections([a, b, c], 'c');
      expect(sidebar.getSelectedConnection()?.id).toBe('c');
      expect(selected).toContain('c');
    } finally {
      await t.dispose();
    }
  });

  test('falls back to the nearest index when the selected id disappears', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const a = connection('a');
    const b = connection('b');
    const c = connection('c');
    const sidebar = createSidebar(t.renderer, [a, b, c]);
    t.renderer.root.add(sidebar);

    try {
      await t.renderOnce();
      sidebar.selectNext();
      expect(sidebar.getSelectedConnection()?.id).toBe('b');

      sidebar.setConnections([a, c]);
      expect(sidebar.getSelectedConnection()?.id).toBe('c');
    } finally {
      await t.dispose();
    }
  });

  test('fills the dot only for connections with a live session', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const never = connection('never');
    // Having connected before must NOT light the dot: the dot means "live now".
    const before = { ...connection('before'), lastConnectedAt: '2026-01-01T00:00:00.000Z' };
    const sidebar = createSidebar(t.renderer, [never, before]);
    t.renderer.root.add(sidebar);

    try {
      await t.renderOnce();
      expect(t.captureCharFrame()).toContain('○ before');

      sidebar.setLiveConnections([before.id]);
      await t.renderOnce();
      const frame = t.captureCharFrame();
      expect(frame).toContain('● before');
      expect(frame).toContain('○ never');
    } finally {
      await t.dispose();
    }
  });
});
