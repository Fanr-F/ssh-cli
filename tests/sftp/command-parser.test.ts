import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import {
  commonPrefix,
  completeCommandName,
  expandLocalTilde,
  hasTrailingSeparator,
  isAbsoluteLocalPath,
  isSameOrDescendantPath,
  parseCommand,
  pathDisplayName,
  remoteBasename,
  resolveCommandPath,
  resolveCompletionScope,
  resolveDownloadTarget,
  resolveMkdirTarget,
  resolveUploadTarget,
} from '../../src/sftp/command-parser';

describe('SFTP command parser', () => {
  test('splits commands and collapses whitespace', () => {
    expect(parseCommand('  upload   a.txt   /tmp/b.txt ')).toEqual({
      command: 'upload',
      args: ['a.txt', '/tmp/b.txt'],
    });
    expect(parseCommand('')).toEqual({ command: '', args: [] });
  });

  test('completes command names by prefix', () => {
    expect(completeCommandName('m')).toEqual(['mkdir', 'mv']);
    expect(completeCommandName('down')).toEqual(['download']);
    expect(completeCommandName('nope')).toEqual([]);
  });

  test('resolves upload destinations against the remote cwd', () => {
    expect(resolveUploadTarget('/home/me', 'C:\\tmp\\a.txt')).toEqual({
      localPath: 'C:\\tmp\\a.txt',
      remotePath: '/home/me/a.txt',
      fileName: 'a.txt',
    });
    expect(resolveUploadTarget('/home/me', 'a.txt', './b.txt')).toEqual({
      localPath: 'a.txt',
      remotePath: '/home/me/b.txt',
      fileName: 'a.txt',
    });
  });

  test('treats a trailing-separator upload destination as a directory', () => {
    expect(resolveUploadTarget('/home/me', 'a.txt', 'docs/')).toEqual({
      localPath: 'a.txt',
      remotePath: '/home/me/docs/a.txt',
      fileName: 'a.txt',
    });
    expect(resolveUploadTarget('/home/me', 'a.txt', '/srv/inbox/').remotePath)
      .toBe('/srv/inbox/a.txt');
  });

  test('resolves download destinations against the local cwd', () => {
    const target = resolveDownloadTarget('/local', '/remote/a.txt');
    expect(target.remotePath).toBe('/remote/a.txt');
    expect(target.localPath).toBe(resolve('/local', 'a.txt'));
    expect(target.fileName).toBe('a.txt');

    expect(resolveDownloadTarget('/local', '/remote/a.txt', 'renamed.txt').localPath)
      .toBe(resolve('/local', 'renamed.txt'));
  });

  test('treats a trailing-separator download destination as a directory', () => {
    expect(resolveDownloadTarget('/local', '/remote/a.txt', 'dir/').localPath)
      .toBe(resolve('/local', 'dir', 'a.txt'));
    expect(resolveDownloadTarget('/local', '/remote/a.txt', '/abs/dir/').localPath)
      .toBe(resolve('/abs/dir', 'a.txt'));
  });

  test('expands a leading local tilde', () => {
    expect(expandLocalTilde('~', '/home/me')).toBe('/home/me');
    expect(expandLocalTilde('~/docs', '/home/me')).toBe(join('/home/me', 'docs'));
    expect(expandLocalTilde('~\\docs', '/home/me')).toBe(join('/home/me', 'docs'));
    expect(expandLocalTilde('/etc/hosts', '/home/me')).toBe('/etc/hosts');
    expect(expandLocalTilde('relative', '/home/me')).toBe('relative');
  });

  test('resolves mkdir on both panels', () => {
    expect(resolveMkdirTarget('local', '/base', '/remote', 'logs')).toBe(join('/base', 'logs'));
    expect(resolveMkdirTarget('remote', '/base', '/remote', 'logs')).toBe('/remote/logs');
  });

  test('resolves command paths with the right separator rules', () => {
    expect(resolveCommandPath('local', '/base', '/remote', 'child')).toBe(resolve('/base', 'child'));
    expect(resolveCommandPath('remote', '/base', '/remote', '../x')).toBe('/x');
  });

  test('detects remote basenames and display names', () => {
    expect(remoteBasename('/home/me/file.txt')).toBe('file.txt');
    expect(pathDisplayName('remote', '/home/me/file.txt')).toBe('file.txt');
  });

  test('rejects moving a directory into itself', () => {
    expect(isSameOrDescendantPath('remote', '/a', '/a')).toBe(true);
    expect(isSameOrDescendantPath('remote', '/a', '/a/b')).toBe(true);
    expect(isSameOrDescendantPath('remote', '/a', '/ab')).toBe(false);
  });

  test('recognises trailing separators for directory intent', () => {
    expect(hasTrailingSeparator('dir/')).toBe(true);
    expect(hasTrailingSeparator('dir\\')).toBe(true);
    expect(hasTrailingSeparator('dir')).toBe(false);
  });

  test('computes a shared prefix', () => {
    expect(commonPrefix(['file-1', 'file-2', 'file-3'])).toBe('file-');
    expect(commonPrefix(['a', 'b'])).toBe('');
    expect(commonPrefix([])).toBe('');
  });

  test('resolves completion scopes for remote and local paths', () => {
    expect(resolveCompletionScope('remote', '/home/me', 'src/fi')).toEqual({
      directory: '/home/me/src',
      prefix: 'fi',
      tokenPrefix: 'src/',
    });
    expect(resolveCompletionScope('remote', '/home/me', '/etc/ho')).toEqual({
      directory: '/etc',
      prefix: 'ho',
      tokenPrefix: '/etc/',
    });
    expect(resolveCompletionScope('local', '/base', 'docs/re')).toEqual({
      directory: join('/base', 'docs'),
      prefix: 're',
      tokenPrefix: 'docs/',
    });
    expect(resolveCompletionScope('remote', '/home/me', 'plain')).toEqual({
      directory: '/home/me',
      prefix: 'plain',
      tokenPrefix: '',
    });
  });

  test('completes local absolute paths without joining the panel cwd', () => {
    expect(resolveCompletionScope('local', '/base', '/etc/ho')).toEqual({
      directory: '/etc',
      prefix: 'ho',
      tokenPrefix: '/etc/',
    });
    expect(isAbsoluteLocalPath('/etc')).toBe(true);
    expect(isAbsoluteLocalPath('relative/path')).toBe(false);
  });

  test.skipIf(process.platform !== 'win32')('recognises Windows drive paths', () => {
    const drive = resolveCompletionScope('local', '/base', 'D:\\foo\\ba');
    expect(drive.directory).toBe('D:\\foo');
    expect(drive.prefix).toBe('ba');
    expect(drive.tokenPrefix).toBe('D:\\foo\\');
  });

  test('recognises UNC paths as absolute', () => {
    const unc = resolveCompletionScope('local', '/base', '\\\\server\\share\\fo');
    expect(unc.directory).toBe('\\\\server\\share');
    expect(unc.prefix).toBe('fo');
    expect(isAbsoluteLocalPath('\\\\server\\share')).toBe(true);
  });
});
