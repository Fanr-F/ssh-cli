import { posix } from 'node:path';

/**
 * Return the parent of an absolute remote path, or null when already at root.
 *
 * Remote paths are always POSIX-style, even when the local machine is Windows.
 * `posix.dirname('/home')` is `/`, which the old split-based implementation
 * accidentally treated as "already at root".
 */
export function remoteParentPath(currentPath: string): string | null {
  const normalized = posix.normalize(currentPath || '/');
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  if (absolute === '/') return null;
  return posix.dirname(absolute);
}

/** Resolve a remote path against a base directory. Absolute targets win. */
export function resolveRemotePath(base: string, target: string): string {
  if (target.startsWith('/')) return posix.normalize(target);
  return posix.join(base || '/', target);
}

/**
 * Expand a leading `~` in a remote path. The home directory is supplied by
 * the caller (SFTP `realpath('.')`), so this stays a pure function.
 * A trailing slash is preserved: callers use it to detect directory targets.
 */
export function expandRemoteTilde(target: string, home: string): string {
  if (!home) return target;
  if (target === '~') return posix.normalize(home);
  if (!target.startsWith('~/')) return target;

  const rest = target.slice(2);
  const wantsTrailingSeparator = rest.endsWith('/');
  const joined = posix.join(home, rest);
  if (wantsTrailingSeparator && !joined.endsWith('/')) return `${joined}/`;
  return joined;
}
