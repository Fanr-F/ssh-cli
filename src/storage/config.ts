import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const CONFIG_DIR_NAME = '.ssh-cli';
const CONFIG_FILE_NAME = 'config.json';

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

/**
 * Ensure the config directory exists.
 * Creates the directory (and any parent directories) if it doesn't exist.
 */
export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
}

/**
 * Check if the config file exists.
 */
export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}
