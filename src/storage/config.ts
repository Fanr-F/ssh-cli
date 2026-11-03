import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const CONFIG_DIR_NAME = '.ssh-cli';
const CONFIG_FILE_NAME = 'config.json';
const KNOWN_HOSTS_FILE_NAME = 'known_hosts.json';

/** Private files are created readable/writable by the current user only. */
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/**
 * Get the config directory path (~/.ssh-cli/).
 * Resolves the home directory using os.homedir() for cross-platform support.
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Get the full path to the config file (~/.ssh-cli/config.json).
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/** Get the path to the TOFU host-key store. */
export function getKnownHostsPath(): string {
  return path.join(getConfigDir(), KNOWN_HOSTS_FILE_NAME);
}

/**
 * Ensure the config directory exists and is private.
 * On Windows the mode bits are largely advisory; the file still lives under
 * the user's home directory and is not shared.
 */
export async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    await fs.chmod(dir, PRIVATE_DIR_MODE);
  } catch {
    // Some filesystems (and Windows) do not support POSIX mode bits.
  }
}

/** Read a private file, returning null when it does not exist. */
export async function readPrivateFile(filePath: string): Promise<string | null> {
  try {
    const contents = await fs.readFile(filePath, 'utf-8');
    // Harden files created by older versions as soon as they are read.
    try { await fs.chmod(filePath, PRIVATE_FILE_MODE); } catch {}
    return contents;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Atomically replace a private file: write a sibling temp file, fsync it,
 * then rename over the target. A crash during the write leaves the previous
 * file intact instead of truncated JSON.
 */
export async function writePrivateFileAtomic(
  filePath: string,
  contents: string,
): Promise<void> {
  await ensureConfigDir();

  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tempPath, 'w', PRIVATE_FILE_MODE);
    await handle.writeFile(contents, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;

    await fs.rename(tempPath, filePath);

    try {
      await fs.chmod(filePath, PRIVATE_FILE_MODE);
    } catch {
      // Windows / unsupported filesystems: best effort only.
    }
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}
