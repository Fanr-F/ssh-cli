import { describe, expect, test } from 'bun:test';
import { SftpClient } from '../../src/sftp/sftp-client';

const DIR_MODE = 0o040755;
const FILE_MODE = 0o100644;
const SYMLINK_MODE = 0o120777;

function entry(filename: string, mode: number, size = 0) {
  return {
    filename,
    longname: filename,
    attrs: { mode, size, mtime: 0, uid: 0, gid: 0 },
  };
}

function fakeSftp(
  entries: ReturnType<typeof entry>[],
  resolved: Record<string, unknown>,
) {
  return {
    readdir: (path: string, cb: (err: Error | null, list: unknown[]) => void) => {
      cb(null, entries);
    },
    stat: (path: string, cb: (err: Error | null, stats?: unknown) => void) => {
      const stats = resolved[path];
      if (!stats) cb(new Error(`ENOENT: ${path}`));
      else cb(null, stats);
    },
  };
}

describe('SftpClient.readdir', () => {
  test('resolves symlinks that point at directories', async () => {
    const client = new SftpClient(fakeSftp(
      [entry('link', SYMLINK_MODE), entry('plain.txt', FILE_MODE, 3)],
      {
        '/home/me/link': {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mode: DIR_MODE,
          mtime: 0,
        },
      },
    ) as any);

    const items = await client.readdir('/home/me');
    const link = items.find((item) => item.name === 'link');
    expect(link?.isSymlink).toBe(true);
    expect(link?.isDirectory).toBe(true);
    expect(link?.isFile).toBe(false);
  });

  test('sorts a resolved symlink directory before files', async () => {
    const client = new SftpClient(fakeSftp(
      [entry('a.txt', FILE_MODE), entry('z-dir-link', SYMLINK_MODE)],
      {
        '/home/me/z-dir-link': {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mode: DIR_MODE,
          mtime: 0,
        },
      },
    ) as any);

    const items = await client.readdir('/home/me');
    expect(items.map((item) => item.name)).toEqual(['z-dir-link', 'a.txt']);
  });

  test('keeps the symlink attrs when its target cannot be read', async () => {
    const client = new SftpClient(fakeSftp(
      [entry('broken', SYMLINK_MODE)],
      {},
    ) as any);

    const items = await client.readdir('/home/me');
    expect(items[0]?.isSymlink).toBe(true);
    expect(items[0]?.isDirectory).toBe(false);
  });

  test('filters dot entries and reports regular entries unchanged', async () => {
    const client = new SftpClient(fakeSftp(
      [entry('.', DIR_MODE), entry('..', DIR_MODE), entry('file.txt', FILE_MODE, 12)],
      {},
    ) as any);

    const items = await client.readdir('/home/me');
    expect(items.map((item) => item.name)).toEqual(['file.txt']);
    expect(items[0]?.isFile).toBe(true);
    expect(items[0]?.size).toBe(12);
  });
});
