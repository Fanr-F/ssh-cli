import { readdir, stat as fsStat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { StyledText, type TextChunk } from '@opentui/core';
import { toRGBA } from '../color';
import { theme } from '../theme';
import type { FileItem } from './types';

/** One-line items are rendered in chunks so moving the cursor is not O(n). */
export const LIST_CHUNK_SIZE = 32;
/** Concurrent stat calls for local directories. */
export const LOCAL_STAT_CONCURRENCY = 32;
/** Windows `attrib` is expensive; cache system-file names briefly. */
export const SYSTEM_NAMES_TTL_MS = 10_000;

const systemNamesCache = new Map<string, { names: Set<string>; expiresAt: number }>();

/**
 * Collect names of Windows system-protected files (System attribute) in a
 * directory. Node's fs.stat does not expose DOS attributes, so we shell out to
 * `attrib` once per directory. Returns an empty set on non-Windows platforms or
 * if `attrib` fails (graceful degradation: show everything).
 */
export async function getWindowsSystemNames(dir: string): Promise<Set<string>> {
  const names = new Set<string>();
  if (process.platform !== 'win32') return names;

  const cached = systemNamesCache.get(dir);
  if (cached && cached.expiresAt > Date.now()) return cached.names;

  try {
    const { execFile } = await import('node:child_process');
    const output = await new Promise<string>((resolve, reject) => {
      execFile('attrib', [`${dir}\\*`], { windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    for (const line of output.split(/\r?\n/)) {
      const sep = line.indexOf(':');
      if (sep < 0) continue;
      const flags = line.slice(0, sep);
      if (flags.includes('S')) {
        names.add(basename(line.slice(sep - 1)));
      }
    }
    if (systemNamesCache.size > 64) systemNamesCache.clear();
    systemNamesCache.set(dir, { names, expiresAt: Date.now() + SYSTEM_NAMES_TTL_MS });
  } catch {
    // attrib unavailable — fall back to showing everything
  }
  return names;
}

/** Read local directory contents. */
export async function readLocalDir(path: string, hideSystem = true): Promise<FileItem[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const systemNames = hideSystem ? await getWindowsSystemNames(path) : new Set<string>();
  const visible = entries.filter(
    (entry) => entry.name !== '.' && entry.name !== '..' && !systemNames.has(entry.name),
  );
  const items: FileItem[] = [];

  // Batch stat calls instead of awaiting them one by one. This is the main
  // difference between a fast and a visibly stalling large directory.
  for (let offset = 0; offset < visible.length; offset += LOCAL_STAT_CONCURRENCY) {
    const batch = visible.slice(offset, offset + LOCAL_STAT_CONCURRENCY);
    const results = await Promise.all(batch.map(async (entry): Promise<FileItem | null> => {
      try {
        const fullPath = join(path, entry.name);
        // `stat` follows symlinks, so a symlink to a directory is navigable
        // and is classified consistently with the target it points at.
        const stats = await fsStat(fullPath);
        return {
          name: entry.name,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          isSymlink: entry.isSymbolicLink(),
          size: stats.size,
          mode: stats.mode,
          mtime: Math.floor(stats.mtimeMs / 1000),
          longname: '',
        };
      } catch {
        // Skip files we can't stat
        return null;
      }
    }));
    for (const item of results) {
      if (item) items.push(item);
    }
  }

  return sortFileItems(items);
}

/** Directories first, then case-insensitive display name. */
export function sortFileItems(items: FileItem[]): FileItem[] {
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

/** Format file size for display. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/** Format timestamp for display. */
export function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${min}`;
}

/** One rendered list row (without the trailing newline). */
export function formatFileLine(item: FileItem): string {
  const prefix = item.isDirectory ? '/' : ' ';
  const sizeStr = item.isDirectory ? '' : ` ${formatSize(item.size).padStart(8)}`;
  const timeStr = item.mtime ? ` ${formatTime(item.mtime)}` : '';
  return ` ${prefix}${item.name}${sizeStr}${timeStr} `;
}

/** Build one column of rendered lines; also used to refresh a single chunk. */
export function buildListChunk(
  state: { items: FileItem[]; selectedIndex: number },
  start: number,
  end: number,
): StyledText {
  const chunks: TextChunk[] = [];
  const selectedFg = toRGBA(theme.appBg);
  const selectedBg = toRGBA(theme.textDim);
  const normalFg = toRGBA(theme.textDim);

  for (let i = start; i < end; i++) {
    const item = state.items[i];
    if (!item) continue;
    if (i > start) {
      chunks.push({ __isChunk: true, text: '\n', fg: normalFg, attributes: 0 });
    }

    const isSelected = i === state.selectedIndex;
    chunks.push({
      __isChunk: true,
      text: formatFileLine(item),
      fg: isSelected ? selectedFg : normalFg,
      ...(isSelected ? { bg: selectedBg } : {}),
      attributes: 0,
    });
  }

  return new StyledText(chunks);
}
