import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createTabBar } from '../../src/ui/tab-bar';

describe('tab bar incremental updates', () => {
  test('title and active changes reuse the existing tab nodes', async () => {
    const t = await createTestRenderer({ width: 100, height: 24 });
    const bar = createTabBar(t.renderer);
    t.renderer.root.add(bar.component);

    try {
      await t.renderOnce();
      const switched: string[] = [];
      bar.onTabSwitch((id) => switched.push(id));

      bar.addTab('t1', 'one', 'terminal');
      bar.addTab('t2', 'two', 'sftp');
      await t.renderOnce();

      expect(bar.getTabIds()).toEqual(['t1', 't2']);
      expect(t.captureCharFrame()).toContain('one');
      expect(t.captureCharFrame()).toContain('two');

      const titleBefore = t.renderer.root.findDescendantById('tab-title-t1');
      expect(titleBefore).toBeTruthy();

      bar.switchTo('t1');
      bar.updateTabTitle('t1', 'SSH: root@example.com');
      await t.renderOnce();

      // Same renderable instance: no remove/add happened.
      expect(t.renderer.root.findDescendantById('tab-title-t1')).toBe(titleBefore);
      expect(t.captureCharFrame()).toContain('SSH: root@example.com');
      expect(switched).toEqual(['t1', 't2', 't1']);
    } finally {
      await t.dispose();
    }
  });

  test('tabs added before mounting are rendered once the bar is mounted', async () => {
    const t = await createTestRenderer({ width: 100, height: 24 });
    const bar = createTabBar(t.renderer);
    bar.addTab('t1', 'early', 'terminal');

    try {
      t.renderer.root.add(bar.component);
      await t.renderOnce();
      bar.setVisible(true);
      await t.renderOnce();

      expect(t.captureCharFrame()).toContain('early');
    } finally {
      await t.dispose();
    }
  });

  test('removing the active tab selects the nearest remaining tab', async () => {
    const t = await createTestRenderer({ width: 100, height: 24 });
    const bar = createTabBar(t.renderer);
    t.renderer.root.add(bar.component);

    try {
      await t.renderOnce();
      bar.addTab('a', 'alpha', 'terminal');
      bar.addTab('b', 'beta', 'terminal');
      bar.switchTo('a');
      await t.renderOnce();

      bar.removeTab('a');
      await t.renderOnce();

      expect(bar.getTabIds()).toEqual(['b']);
      expect(bar.getActiveTabId()).toBe('b');
      expect(t.captureCharFrame()).not.toContain('alpha');
      expect(t.captureCharFrame()).toContain('beta');
    } finally {
      await t.dispose();
    }
  });
});
