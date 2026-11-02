import { afterEach, describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSftpTab } from './sftp-tab';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('createSftpTab', () => {
  test('renders a large remote directory and reuses the listing within the TTL', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'ssh-cli-sftp-local-'));
    tempDirs.push(localDir);
    await writeFile(join(localDir, 'local.txt'), 'hello', 'utf-8');

    const remoteItems = Array.from({ length: 100 }, (_, index) => ({
      name: `file-${String(index).padStart(3, '0')}.txt`,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
      size: index,
      mode: 0,
      mtime: 0,
      longname: '',
    }));

    let remoteReads = 0;
    const fakeClient = {
      realpath: async () => '/remote',
      readdir: async () => {
        remoteReads += 1;
        return remoteItems;
      },
      close: () => {},
    };

    const t = await createTestRenderer({ width: 120, height: 30 });
    const tab = createSftpTab(
      'sftp-test',
      t.renderer,
      fakeClient as any,
      '~',
      localDir,
    );

    try {
      t.renderer.root.add(tab.component);
      await t.renderOnce();
      await tab.refresh();
      await t.renderOnce();

      const frame = t.captureCharFrame();
      expect(frame).toContain('file-000');
      expect(frame).toContain('/remote');

      const readsAfterFirstRefresh = remoteReads;
      await tab.refresh();
      expect(remoteReads).toBe(readsAfterFirstRefresh);
    } finally {
      tab.destroy();
      await t.dispose();
    }
  });
});
