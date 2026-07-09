/** File/directory entry from readdir. */
export interface FileEntry {
  filename: string;
  longname: string;
  attrs: {
    mode: number;
    uid: number;
    gid: number;
    size: number;
    atime: number;
    mtime: number;
  };
}

/** Computed file info for display. */
export interface FileItem {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  mode: number;
  mtime: number;
  longname: string;
}

/** Transfer task status. */
export type TransferStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';

/** A single file transfer task. */
export interface TransferTask {
  id: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  speed: number;
  error?: string;
}

/** SFTP panel focus side. */
export type PanelSide = 'local' | 'remote';
