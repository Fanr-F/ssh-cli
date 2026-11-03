import { describe, expect, test } from 'bun:test';
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
});
