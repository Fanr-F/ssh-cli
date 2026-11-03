import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  isTransferCancelled,
  SftpClient,
  TransferCancelledError,
} from '../../src/sftp/sftp-client';

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

describe('SftpClient transfers', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ssh-cli-sftp-client-'));
    tempDirs.push(dir);
    return dir;
  }

  /** Collect everything written through the fake remote stream. */
  function collectSink() {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    return { sink, text: () => Buffer.concat(chunks).toString('utf-8') };
  }

  test('upload copies the file and reports progress', async () => {
    const dir = await tempDir();
    const localPath = join(dir, 'a.txt');
    await writeFile(localPath, 'hello remote', 'utf-8');
    const remote = collectSink();
    const progress: Array<[number, number]> = [];

    const client = new SftpClient({
      createWriteStream: () => remote.sink,
    } as any);

    await client.upload(localPath, '/remote/a.txt', {
      onProgress: (transferred, total) => progress.push([transferred, total]),
    });

    expect(remote.text()).toBe('hello remote');
    expect(progress.at(-1)).toEqual([12, 12]);
  });

  test('upload rejects with TransferCancelledError and removes the partial file', async () => {
    const dir = await tempDir();
    const localPath = join(dir, 'a.txt');
    await writeFile(localPath, 'x'.repeat(4096), 'utf-8');
    const remote = collectSink();
    const removed: string[] = [];
    const controller = new AbortController();

    const client = new SftpClient({
      createWriteStream: () => remote.sink,
      unlink: (path: string, cb: (err: Error | null) => void) => {
        removed.push(path);
        cb(null);
      },
    } as any);

    const promise = client.upload(localPath, '/remote/a.txt', {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    await expect(promise).rejects.toBeInstanceOf(TransferCancelledError);
    expect(removed).toEqual(['/remote/a.txt']);
  });

  test('upload with an already-aborted signal never starts copying', async () => {
    const dir = await tempDir();
    const localPath = join(dir, 'a.txt');
    await writeFile(localPath, 'abc', 'utf-8');
    const remote = collectSink();
    const controller = new AbortController();
    controller.abort();

    const client = new SftpClient({
      createWriteStream: () => remote.sink,
      unlink: (_path: string, cb: (err: Error | null) => void) => cb(null),
    } as any);

    const err = await client
      .upload(localPath, '/remote/a.txt', { signal: controller.signal })
      .catch((e: unknown) => e);

    expect(isTransferCancelled(err)).toBe(true);
    expect(remote.text()).toBe('');
  });

  test('download writes the file locally and reports progress', async () => {
    const dir = await tempDir();
    const localPath = join(dir, 'b.txt');
    const progress: Array<[number, number]> = [];

    const client = new SftpClient({
      createReadStream: () => Readable.from([Buffer.from('down')]),
      stat: (_path: string, cb: (err: Error | null, stats?: unknown) => void) =>
        cb(null, { size: 4 }),
    } as any);

    await client.download('/remote/b.txt', localPath, {
      onProgress: (transferred, total) => progress.push([transferred, total]),
    });

    expect(await readFile(localPath, 'utf-8')).toBe('down');
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  test('download cancels mid-transfer and deletes the partial local file', async () => {
    const dir = await tempDir();
    const localPath = join(dir, 'b.txt');
    const controller = new AbortController();

    const client = new SftpClient({
      createReadStream: () => Readable.from([Buffer.alloc(1024, 1)]),
      stat: (_path: string, cb: (err: Error | null, stats?: unknown) => void) =>
        cb(null, { size: 1024 }),
    } as any);

    const promise = client.download('/remote/b.txt', localPath, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    await expect(promise).rejects.toBeInstanceOf(TransferCancelledError);
    await expect(stat(localPath)).rejects.toThrow();
  });
});

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
