import { posix } from 'node:path';
import type { SFTPWrapper, Stats } from 'ssh2-no-cpu-features';
import type { FileEntry, FileItem } from './types';
import { sortFileItems } from './file-list';
import { createLogger } from '../logger';

const log = createLogger('sftp');

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

  /** Upload a local file to remote with progress callback. */
  async upload(
    localPath: string,
    remotePath: string,
    onProgress?: (bytesUploaded: number, totalBytes: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.fastPut(localPath, remotePath, {
        step: (totalTransferred: number, chunk: number, total: number) => {
          onProgress?.(totalTransferred, total);
        },
      }, (err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Download a remote file to local with progress callback. */
  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.fastGet(remotePath, localPath, {
        step: (totalTransferred: number, chunk: number, total: number) => {
          onProgress?.(totalTransferred, total);
        },
      }, (err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Close the SFTP session. */
  close(): void {
    this.sftp.end();
  }
}
