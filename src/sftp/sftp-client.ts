import { createReadStream, createWriteStream } from 'node:fs';
import { stat as fsStat, unlink as fsUnlink } from 'node:fs/promises';
import { posix } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { SFTPWrapper, Stats } from 'ssh2-no-cpu-features';
import type { FileEntry, FileItem } from './types';
import { sortFileItems } from './file-list';
import { createLogger } from '../logger';

const log = createLogger('sftp');

/** Optional knobs shared by `upload()` / `download()`. */
export interface TransferOptions {
  /** Called for every chunk with the running byte count and the file size. */
  onProgress?: (transferred: number, total: number) => void;
  /** Abort the transfer; the promise then rejects with `TransferCancelledError`. */
  signal?: AbortSignal;
}

/** Thrown when a transfer was aborted through `TransferOptions.signal`. */
export class TransferCancelledError extends Error {
  constructor() {
    super('Transfer cancelled');
    this.name = 'TransferCancelledError';
  }
}

/** True for the rejection produced by aborting a transfer. */
export function isTransferCancelled(err: unknown): err is TransferCancelledError {
  return err instanceof TransferCancelledError;
}

/** Best-effort stream teardown; ssh2 closes the remote handle in `_destroy`. */
function destroyStream(stream: Readable | Writable): void {
  try {
    stream.destroy();
  } catch (err) {
    log.debug('Could not destroy transfer stream: {reason}', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Promisified SFTP client wrapper.
 * Wraps ssh2's callback-based SFTP API with async/await.
 */
export class SftpClient {
  private sftp: SFTPWrapper;

  constructor(sftp: SFTPWrapper) {
    this.sftp = sftp;
  }

  /** List directory contents. */
  async readdir(path: string): Promise<FileItem[]> {
    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      this.sftp.readdir(path, (err: Error | null | undefined, entries: FileEntry[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(entries);
      });
    });

    const items: FileItem[] = list
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((e) => ({
        name: e.filename,
        isDirectory: (e.attrs.mode & 0o170000) === 0o040000,
        isFile: (e.attrs.mode & 0o170000) === 0o100000,
        isSymlink: (e.attrs.mode & 0o170000) === 0o120000,
        size: e.attrs.size,
        mode: e.attrs.mode,
        mtime: e.attrs.mtime,
        longname: e.longname,
      }));

    // SSH_FXP_READDIR reports a symlink's own mode, so a symlink to a
    // directory looks like a non-directory. Resolve those targets once so the
    // remote panel behaves like the local one (which uses fs.stat).
    await Promise.all(items.map(async (item) => {
      if (!item.isSymlink) return;
      try {
        const target = await this.stat(posix.join(path, item.name));
        item.isDirectory = target.isDirectory();
        item.isFile = target.isFile();
        item.size = target.size;
        item.mode = target.mode;
      } catch (err) {
        // Broken link / permission denied: keep the symlink's own attrs.
        log.debug('Could not resolve symlink {path}: {reason}', {
          path: posix.join(path, item.name),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }));

    return sortFileItems(items);
  }

  /** Promisify one callback-style ssh2 SFTP call. */
  private call<T>(
    invoke: (cb: (err: Error | null | undefined, result?: T) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      invoke((err, result) => {
        if (err) reject(err);
        else resolve(result as T);
      });
    });
  }

  /** Get file/directory stats. */
  async stat(path: string): Promise<Stats> {
    return this.call<Stats>((cb) => this.sftp.stat(path, cb));
  }

  /** Create a directory. */
  async mkdir(path: string): Promise<void> {
    await this.call<void>((cb) => this.sftp.mkdir(path, cb));
  }

  /** Remove a directory. */
  async rmdir(path: string): Promise<void> {
    await this.call<void>((cb) => this.sftp.rmdir(path, cb));
  }

  /** Delete a file. */
  async unlink(path: string): Promise<void> {
    await this.call<void>((cb) => this.sftp.unlink(path, cb));
  }

  /** Rename/move a file or directory. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.call<void>((cb) => this.sftp.rename(oldPath, newPath, cb));
  }

  /** Get real path (resolve symlinks, ~, etc). */
  async realpath(path: string): Promise<string> {
    return this.call<string>((cb) => this.sftp.realpath(path, cb));
  }

  /**
   * Copy a readable into a writable while reporting progress and honouring an
   * abort signal. Resolves on `finish`; the streams are destroyed on abort so
   * the remote handle is closed and no more chunks are read.
   */
  private pipeTransfer(
    source: Readable,
    target: Writable,
    total: number,
    options: TransferOptions,
  ): Promise<void> {
    const { onProgress, signal } = options;

    return new Promise<void>((resolve, reject) => {
      let transferred = 0;
      let settled = false;

      const settle = (err?: unknown): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (err === undefined) {
          resolve();
          return;
        }
        destroyStream(source);
        destroyStream(target);
        reject(err);
      };

      const onAbort = (): void => settle(new TransferCancelledError());

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      source.on('data', (chunk: Buffer | string) => {
        transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        onProgress?.(transferred, total);
      });
      source.once('error', (err) => settle(err));
      target.once('error', (err) => settle(err));
      target.once('finish', () => settle());
      // A write stream that closes without finishing means the remote side
      // dropped the transfer; surface it instead of hanging forever.
      target.once('close', () => {
        if (!(target as Writable & { writableFinished?: boolean }).writableFinished) {
          settle(new Error('Transfer interrupted'));
        }
      });

      source.pipe(target);
    });
  }

  /** Local file size, or 0 when it cannot be read (progress hides the total). */
  private async localSize(path: string): Promise<number> {
    try {
      return (await fsStat(path)).size;
    } catch {
      return 0;
    }
  }

  /** Remote file size, or 0 when it cannot be read. */
  private async remoteSize(path: string): Promise<number> {
    try {
      return (await this.stat(path)).size;
    } catch {
      return 0;
    }
  }

  /** Upload a local file to remote with progress and cancellation. */
  async upload(
    localPath: string,
    remotePath: string,
    options: TransferOptions = {},
  ): Promise<void> {
    const total = await this.localSize(localPath);
    try {
      await this.pipeTransfer(
        createReadStream(localPath),
        this.sftp.createWriteStream(remotePath),
        total,
        options,
      );
    } catch (err) {
      // Do not leave a half-written file behind when the user cancels.
      if (isTransferCancelled(err)) {
        await this.unlink(remotePath).catch(() => {});
      }
      throw err;
    }
  }

  /** Download a remote file to local with progress and cancellation. */
  async download(
    remotePath: string,
    localPath: string,
    options: TransferOptions = {},
  ): Promise<void> {
    const total = await this.remoteSize(remotePath);
    try {
      await this.pipeTransfer(
        this.sftp.createReadStream(remotePath),
        createWriteStream(localPath),
        total,
        options,
      );
    } catch (err) {
      if (isTransferCancelled(err)) {
        await fsUnlink(localPath).catch(() => {});
      }
      throw err;
    }
  }

  /** Close the SFTP session. */
  close(): void {
    this.sftp.end();
  }
}
