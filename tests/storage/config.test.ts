import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPrivateFile, writePrivateFileAtomic } from '../../src/storage/config';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ssh-cli-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('writePrivateFileAtomic', () => {
  test('returns null for a missing file', async () => {
    const dir = await tempDir();
    expect(await readPrivateFile(join(dir, 'missing.json'))).toBeNull();
  });

  test('writes and replaces a file without leaving temp files', async () => {
    const dir = await tempDir();
    const file = join(dir, 'config.json');

    await writePrivateFileAtomic(file, 'first');
    expect(await readPrivateFile(file)).toBe('first');

    await writePrivateFileAtomic(file, 'second');
    expect(await readPrivateFile(file)).toBe('second');
    expect(await readdir(dir)).toEqual(['config.json']);
  });
});
