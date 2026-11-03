import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { App } from '../src/app';

function key(name: string, sequence: string) {
  return {
    name,
    sequence,
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    preventDefault: () => {},
  } as any;
}

describe('App tab teardown', () => {
  test('disposeTab removes the tab, disconnects once, and shows idle', async () => {
    const t = await createTestRenderer({ width: 80, height: 24 });
    const app = new App(t.renderer);

    try {
      (app as any).connections = [];
      (app as any).buildLayout();

      let disconnects = 0;
      const ssh = {
        isConnected: () => false,
        getLastError: () => null,
        disconnect: async () => { disconnects += 1; },
        writeToShell: () => {},
        resizePty: () => {},
      };

      (app as any).tabs.set('t1', {
        term: {},
        ssh,
        config: {
          id: 'c1',
          name: 'Connection',
          host: 'example.com',
          port: 22,
          username: 'root',
          authType: 'key',
          createdAt: '2026-11-02T00:00:00.000Z',
        },
        altScreen: { active: false, feed: () => {}, reset: () => {} },
      });
      (app as any).tabBar.addTab('t1', 'test', 'terminal');

      await (app as any).disposeTab('t1');
      await (app as any).disposeTab('t1');
      await t.renderOnce();

      expect((app as any).tabs.size).toBe(0);
      expect((app as any).tabBar.getTabIds()).toEqual([]);
      expect(disconnects).toBe(1);
      expect(t.captureCharFrame()).toContain('Select a connection');
    } finally {
      await (app as any).clipboard?.dispose?.();
      await t.dispose();
    }
  });

  test('disposing the active tab switches to the remaining tab', async () => {

    const t = await createTestRenderer({ width: 80, height: 24 });
    const app = new App(t.renderer);

    try {
      (app as any).connections = [];
      (app as any).buildLayout();

      const makeSsh = () => ({
        isConnected: () => false,
        getLastError: () => null,
        disconnect: async () => {},
        writeToShell: () => {},
        resizePty: () => {},
      });
      const config = {
        id: 'c1',
        name: 'Connection',
        host: 'example.com',
        port: 22,
        username: 'root',
        authType: 'key' as const,
        createdAt: '2026-11-02T00:00:00.000Z',
      };
      const altScreen = { active: false, feed: () => {}, reset: () => {} };

      (app as any).tabs.set('t1', { term: {}, ssh: makeSsh(), config, altScreen });
      (app as any).tabs.set('t2', { term: {}, ssh: makeSsh(), config, altScreen });
      (app as any).tabBar.addTab('t1', 'one', 'terminal');
      (app as any).tabBar.addTab('t2', 'two', 'terminal');

      await (app as any).disposeTab('t2');

      expect((app as any).tabs.size).toBe(1);
      expect((app as any).tabBar.getActiveTabId()).toBe('t1');
    } finally {
      await (app as any).clipboard?.dispose?.();
      await t.dispose();
    }
  });
});

describe('App confirmation modal', () => {
  test('blocks other keys, resolves on Escape, and restores focus', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const app = new App(t.renderer);

    try {
      (app as any).connections = [];
      (app as any).buildLayout();

      const pending = (app as any).requestConfirm({
        title: 'Test',
        message: 'Delete "x"?',
      });
      expect((app as any).buildKeyContext().confirmOpen).toBe(true);

      await (app as any).dispatchKey(key('escape', '\x1b'));

      expect(await pending).toBe(false);
      expect((app as any).confirmDialog).toBeNull();
      expect((app as any).buildKeyContext().confirmOpen).toBe(false);
      expect((app as any).focus).toBe('sidebar');
    } finally {
      await (app as any).clipboard?.dispose?.();
      await t.dispose();
    }
  });

  test('Tab then Enter confirms', async () => {
    const t = await createTestRenderer({ width: 100, height: 30 });
    const app = new App(t.renderer);

    try {
      (app as any).connections = [];
      (app as any).buildLayout();

      const pending = (app as any).requestConfirm({
        title: 'Test',
        message: 'Delete "x"?',
      });

      await (app as any).dispatchKey(key('tab', '\t'));
      await (app as any).dispatchKey(key('enter', '\r'));

      expect(await pending).toBe(true);
      expect((app as any).confirmDialog).toBeNull();
    } finally {
      await (app as any).clipboard?.dispose?.();
      await t.dispose();
    }
  });
});
