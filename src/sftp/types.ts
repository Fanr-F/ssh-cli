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

/** SFTP panel focus side. */
export type PanelSide = 'local' | 'remote';
