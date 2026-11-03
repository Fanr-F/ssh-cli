import { afterEach, describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSftpTab, formatTransferProgress } from '../../src/sftp/sftp-tab';
import { TransferCancelledError } from '../../src/sftp/sftp-client';

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

  test('cd ~ expands to the remote home directory', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'ssh-cli-sftp-local-'));
    tempDirs.push(localDir);
    const remoteReads: string[] = [];

    const fakeClient = {
      realpath: async () => '/home/me',
      readdir: async (path: string) => {
        remoteReads.push(path);
        return [];
      },
      stat: async () => {
        throw new Error('ENOENT');
      },
      close: () => {},
    };

    const t = await createTestRenderer({ width: 120, height: 30 });
    const tab = createSftpTab(
      'sftp-tilde',
      t.renderer,
      fakeClient as any,
      '~',
      localDir,
    );

    try {
      t.renderer.root.add(tab.component);
      await t.renderOnce();
      await tab.refresh();
      remoteReads.length = 0;

      await (tab.handleKey as any)(key(':', ':'));
      for (const char of 'cd ~') {
        await (tab.handleKey as any)(key(char === ' ' ? 'space' : char, char));
      }
      await (tab.handleKey as any)(key('enter', '\r'));
      await t.renderOnce();

      expect(remoteReads).toContain('/home/me');
    } finally {
      tab.destroy();
      await t.dispose();
    }
  });
});

describe('createSftpTab transfer cancellation', () => {
  test('Esc aborts the running upload and restores the help line', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'ssh-cli-sftp-local-'));
    tempDirs.push(localDir);
    const localPath = join(localDir, 'big.bin');
    await writeFile(localPath, 'x', 'utf-8');

    let uploadSignal: AbortSignal | undefined;
    let uploadStarted = false;
    const fakeClient = {
      realpath: async () => '/remote',
      readdir: async () => [],
      stat: async () => {
        throw new Error('ENOENT');
      },
      close: () => {},
      upload: (_local: string, _remote: string, options: {
        signal: AbortSignal;
      }) => {
        uploadStarted = true;
        uploadSignal = options.signal;
        return new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new TransferCancelledError()),
            { once: true },
          );
        });
      },
    };

    const t = await createTestRenderer({ width: 120, height: 30 });
    const tab = createSftpTab('sftp-cancel', t.renderer, fakeClient as any, '~', localDir);

    try {
      t.renderer.root.add(tab.component);
      await t.renderOnce();
      await tab.refresh();

      await (tab.handleKey as any)(key(':', ':'));
      for (const char of `upload ${localPath}`) {
        await (tab.handleKey as any)(key(char === ' ' ? 'space' : char, char));
      }

      // Enter starts the transfer, which only settles once it is cancelled.
      const pending = (tab.handleKey as any)(key('enter', '\r'));
      await Promise.resolve();

      expect(uploadStarted).toBe(true);
      expect(tab.isTransferring()).toBe(true);
      await t.renderOnce();
      expect(t.captureCharFrame()).toContain('cancels');

      await (tab.handleKey as any)(key('escape', '\x1b'));
      expect(uploadSignal?.aborted).toBe(true);

      await pending;
      await t.renderOnce();
      expect(tab.isTransferring()).toBe(false);
      expect(t.captureCharFrame()).not.toContain('cancels');
    } finally {
      tab.destroy();
      await t.dispose();
    }
  });
});

describe('formatTransferProgress', () => {
  test('renders percentage, transferred and total bytes', () => {
    expect(formatTransferProgress('Uploading a.txt', 512, 1024))
      .toBe('Uploading a.txt 50% (512B/1.0K)');
  });

  test('clamps at 100% and omits the percentage when the total is unknown', () => {
    expect(formatTransferProgress('Downloading b', 2048, 1024))
      .toBe('Downloading b 100% (2.0K/1.0K)');
    expect(formatTransferProgress('Downloading b', 300, 0))
      .toBe('Downloading b (300B)');
  });
});
