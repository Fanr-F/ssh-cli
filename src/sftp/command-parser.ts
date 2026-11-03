import { basename, isAbsolute, join, resolve, sep as pathSep } from 'node:path';
import type { PanelSide } from './types';
import { resolveRemotePath } from './paths';

export const KNOWN_COMMANDS = [
  'upload',
  'download',
  'mkdir',
  'rm',
  'mv',
  'cd',
  'refresh',
  'hidden',
] as const;

export interface ParsedCommand {
  command: string;
  args: string[];
}

/** Split an SFTP command line into the command name and arguments. */
export function parseCommand(input: string): ParsedCommand {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  return { command: parts[0] ?? '', args: parts.slice(1) };
}

/** Command-name completions for the first token of the command line. */
export function completeCommandName(token: string): string[] {
  return KNOWN_COMMANDS.filter((command) => command.startsWith(token));
}

/** Resolve a local path against a base directory. */
export function resolveLocalPath(base: string, target: string): string {
  return isAbsolute(target) ? target : resolve(base, target);
}

/** Resolve a path for whichever panel is active. */
export function resolveCommandPath(
  side: PanelSide,
  localBase: string,
  remoteBase: string,
  target: string,
): string {
  return side === 'local'
    ? resolveLocalPath(localBase, target)
    : resolveRemotePath(remoteBase, target);
}

/** Last path segment; remote paths are always POSIX-style. */
export function pathDisplayName(side: PanelSide, path: string): string {
  if (side === 'local') return basename(path);
  return remoteBasename(path);
}

export function remoteBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** Remote destination for `upload <local> [remote]`. */
export function resolveUploadTarget(
  remoteCwd: string,
  source: string,
  rawDest?: string,
): { localPath: string; remotePath: string; fileName: string } {
  const fileName = basename(source);
  const remotePath = !rawDest || rawDest === '.' || rawDest === './'
    ? resolveRemotePath(remoteCwd, fileName)
    : resolveRemotePath(remoteCwd, rawDest);
  return { localPath: source, remotePath, fileName };
}

/** Local destination for `download <remote> [local]`. */
export function resolveDownloadTarget(
  localCwd: string,
  source: string,
  rawDest?: string,
): { remotePath: string; localPath: string; fileName: string } {
  const fileName = remoteBasename(source);
  const localPath = !rawDest || rawDest === '.' || rawDest === '.\\' || rawDest === './'
    ? resolve(localCwd, fileName)
    : resolveLocalPath(localCwd, rawDest);
  return { remotePath: source, localPath, fileName };
}

/** Destination for `mkdir <name>` on the active panel. */
export function resolveMkdirTarget(
  side: PanelSide,
  localCwd: string,
  remoteCwd: string,
  name: string,
): string {
  return side === 'local'
    ? join(localCwd, name)
    : resolveRemotePath(remoteCwd, name);
}

/**
 * Whether `candidate` is the same path as `parent` or lives below it.
 * Used to reject `mv dir dir/sub` before touching the filesystem.
 */
export function isSameOrDescendantPath(side: PanelSide, parent: string, candidate: string): boolean {
  if (parent === candidate) return true;
  const sep = side === 'local' ? (parent.includes(pathSep) ? pathSep : '/') : '/';
  return candidate.startsWith(parent + sep);
}

/** Whether a destination argument ends with a directory separator. */
export function hasTrailingSeparator(path: string): boolean {
  return /[\\/]$/.test(path);
}

/** Longest common prefix shared by every name. */
export function commonPrefix(names: readonly string[]): string {
  if (names.length === 0) return '';
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (prefix.length > 0 && !name.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) break;
  }
  return prefix;
}

export interface CompletionScope {
  /** Directory whose entries should be listed. */
  directory: string;
  /** Name prefix to match inside that directory. */
  prefix: string;
  /** Text before the prefix (including the separator), reused when completing. */
  tokenPrefix: string;
}

/**
 * Split a partially typed path token into the directory to list, the name
 * prefix and the text before that prefix. Handles Windows separators locally
 * and POSIX-only remote paths.
 */
export function resolveCompletionScope(
  side: PanelSide,
  currentPath: string,
  token: string,
): CompletionScope {
  const lastSep = side === 'local'
    ? Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
    : token.lastIndexOf('/');
  if (lastSep < 0) {
    return { directory: currentPath, prefix: token, tokenPrefix: '' };
  }

  const tokenDir = token.slice(0, lastSep);
  const prefix = token.slice(lastSep + 1);
  const tokenPrefix = token.slice(0, lastSep + 1);

  if (side === 'local') {
    return { directory: join(currentPath, tokenDir), prefix, tokenPrefix };
  }
  if (tokenDir.startsWith('/')) {
    return { directory: tokenDir || '/', prefix, tokenPrefix };
  }
  return { directory: resolveRemotePath(currentPath, tokenDir), prefix, tokenPrefix };
}
