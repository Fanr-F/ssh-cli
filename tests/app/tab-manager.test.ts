import { describe, expect, test } from 'bun:test';
import { TabManager } from '../../src/app/tab-manager';

function fakeTab(id: string) {
  let disconnects = 0;
  return {
    tab: {
      term: {} as any,
      ssh: {
        isConnected: () => false,
        disconnect: async () => { disconnects += 1; },
      } as any,
      config: { id } as any,
      altScreen: { active: false, feed: () => {}, reset: () => {} },
    },
    disconnects: () => disconnects,
  };
}

function createManager() {
  const calls: string[] = [];
  const manager = new TabManager({
    unregisterTerminal: (id) => calls.push(`unregister:${id}`),
    removeSftpNode: () => calls.push('remove-sftp'),
    removeTabFromBar: (id) => calls.push(`remove-tab:${id}`),
    onAllTabsClosed: () => calls.push('idle'),
    requestRender: () => {},
  });
  return { manager, calls };
}

describe('TabManager', () => {
  test('disposes once, disconnects once, and shows idle after the last tab', async () => {
    const { manager, calls } = createManager();
    const { tab, disconnects } = fakeTab('t1');
    manager.set('t1', tab as any);

    await manager.dispose('t1');
    await manager.dispose('t1');

    expect(manager.size).toBe(0);
    expect(disconnects()).toBe(1);
    expect(calls).toEqual(['unregister:t1', 'remove-tab:t1', 'idle']);
  });

  test('keepPanel skips the idle placeholder', async () => {
    const { manager, calls } = createManager();
    const { tab } = fakeTab('t1');
    manager.set('t1', tab as any);

    await manager.dispose('t1', { keepPanel: true });

    expect(calls).toEqual(['unregister:t1', 'remove-tab:t1']);
  });

  test('clear returns every tab for shutdown disconnects', () => {
    const { manager } = createManager();
    const a = fakeTab('a');
    const b = fakeTab('b');
    manager.set('a', a.tab as any);
    manager.set('b', b.tab as any);

    const cleared = manager.clear();

    expect(cleared).toHaveLength(2);
    expect(manager.size).toBe(0);
  });
});
