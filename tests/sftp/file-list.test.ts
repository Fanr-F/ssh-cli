import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatFileLine,
  formatSize,
  formatTime,
  parseAttribLine,
  readLocalDir,
  sortFileItems,
} from '../../src/sftp/file-list';
import type { FileItem } from '../../src/sftp/types';

const tempDirs: string[] = [];

function item(name: string, isDirectory = false, size = 0, mtime = 0): FileItem {
  return { name, isDirectory, isFile: !isDirectory, isSymlink: false, size, mode: 0, mtime, longname: '' };
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('SFTP file list helpers', () => {
  test('formats sizes with stable units', () => {
    expect(formatSize(0)).toBe('0B');
    expect(formatSize(1023)).toBe('1023B');
    expect(formatSize(1024)).toBe('1.0K');
    expect(formatSize(1024 * 1024)).toBe('1.0M');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0G');
  });

  test('formats timestamps as MM-DD HH:mm', () => {
    expect(formatTime(0)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('puts directories before files and sorts by name', () => {
    const sorted = sortFileItems([
      item('b.txt'),
      item('z-dir', true),
      item('a.txt'),
      item('a-dir', true),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(['a-dir', 'z-dir', 'a.txt', 'b.txt']);
  });

  test('renders directory and file rows', () => {
    expect(formatFileLine(item('src', true))).toBe(' /src ');
    expect(formatFileLine(item('a.txt', false, 1024, 0))).toBe('  a.txt     1.0K ');
  });

  test('reads local directory entries and classifies directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ssh-cli-file-list-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'file.txt'), 'hello', 'utf-8');
    await mkdir(join(dir, 'nested'));

    const entries = await readLocalDir(dir, false);
    expect(entries.map((entry) => entry.name)).toEqual(['nested', 'file.txt']);
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[1].isFile).toBe(true);
    expect(entries[1].size).toBe(5);
  });

  test('keeps entries whose stat fails (dangling symlinks)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ssh-cli-file-list-'));
    tempDirs.push(dir);
    try {
      await symlink(join(dir, 'missing-target'), join(dir, 'dangling'));
    } catch {
      // Creating symlinks needs extra privileges on some Windows setups.
      return;
    }

    const entries = await readLocalDir(dir, false);
    const dangling = entries.find((entry) => entry.name === 'dangling');
    expect(dangling).toBeDefined();
    expect(dangling?.isSymlink).toBe(true);
    expect(dangling?.isDirectory).toBe(false);
  });
});

describe('parseAttribLine', () => {
  test('detects the System attribute', () => {
    expect(parseAttribLine('A    S            C:\\dir\\pagefile.sys')).toEqual({
      name: 'pagefile.sys',
      isSystem: true,
    });
  });

  test('does not mistake an S: drive letter for the System attribute', () => {
    expect(parseAttribLine('A                 S:\\dir\\normal.txt')).toEqual({
      name: 'normal.txt',
      isSystem: false,
    });
  });

  test('parses UNC paths and other flags', () => {
    expect(parseAttribLine('     R     H      \\\\server\\share\\hidden.txt')).toEqual({
      name: 'hidden.txt',
      isSystem: false,
    });
  });

  test('ignores lines without a path', () => {
    expect(parseAttribLine('')).toBeNull();
    expect(parseAttribLine('garbage')).toBeNull();
  });
});
