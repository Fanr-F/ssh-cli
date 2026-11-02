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
