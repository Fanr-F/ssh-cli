import type { SFTPWrapper, Stats } from 'ssh2-no-cpu-features';
import type { FileEntry, FileItem } from './types';
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
    return new Promise((resolve, reject) => {
      this.sftp.readdir(path, (err: Error | undefined, list: FileEntry[]) => {
        if (err) {
          reject(err);
          return;
        }
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
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        resolve(items);
      });
    });
  }

  /** Get file/directory stats. */
  async stat(path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      this.sftp.stat(path, (err: Error | undefined, stats: Stats) => {
        if (err) reject(err);
        else resolve(stats);
      });
    });
  }

  /** Create a directory. */
  async mkdir(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.mkdir(path, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Remove a directory. */
  async rmdir(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.rmdir(path, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Delete a file. */
  async unlink(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.unlink(path, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Rename/move a file or directory. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.rename(oldPath, newPath, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Change file permissions. */
  async chmod(path: string, mode: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.chmod(path, mode, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Get real path (resolve symlinks, ~, etc). */
  async realpath(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.sftp.realpath(path, (err: Error | undefined, resolvedPath: string) => {
        if (err) reject(err);
        else resolve(resolvedPath);
      });
    });
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
      }, (err: Error | undefined) => {
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
      }, (err: Error | undefined) => {
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
