import { describe, expect, test } from 'bun:test';
import { expandRemoteTilde, remoteParentPath, resolveRemotePath } from '../../src/sftp/paths';

describe('remoteParentPath', () => {
  test('returns null at the remote root', () => {
    expect(remoteParentPath('/')).toBeNull();
  });

  test('moves from a top-level directory to root', () => {
    expect(remoteParentPath('/home')).toBe('/');
  });

  test('returns the parent of a nested directory', () => {
    expect(remoteParentPath('/home/user')).toBe('/home');
  });

  test('ignores a trailing slash', () => {
    expect(remoteParentPath('/home/user/')).toBe('/home');
  });
});

describe('resolveRemotePath', () => {
  test('joins a relative path to the current directory', () => {
    expect(resolveRemotePath('/home/user', 'docs')).toBe('/home/user/docs');
  });

  test('does not duplicate slashes when the base has a trailing slash', () => {
    expect(resolveRemotePath('/home/user/', 'docs')).toBe('/home/user/docs');
  });

  test('keeps an absolute target', () => {
    expect(resolveRemotePath('/home/user', '/etc/ssh')).toBe('/etc/ssh');
  });

  test('normalizes parent segments', () => {
    expect(resolveRemotePath('/home/user', '../other')).toBe('/home/other');
  });
});

describe('expandRemoteTilde', () => {
  test('expands a bare tilde to the remote home', () => {
    expect(expandRemoteTilde('~', '/home/me')).toBe('/home/me');
  });

  test('expands a tilde prefix', () => {
    expect(expandRemoteTilde('~/docs', '/home/me')).toBe('/home/me/docs');
  });

  test('preserves a trailing separator used to signal a directory', () => {
    expect(expandRemoteTilde('~/docs/', '/home/me')).toBe('/home/me/docs/');
  });

  test('leaves other paths untouched', () => {
    expect(expandRemoteTilde('/etc/ssh', '/home/me')).toBe('/etc/ssh');
    expect(expandRemoteTilde('relative/path', '/home/me')).toBe('relative/path');
    expect(expandRemoteTilde('~', '')).toBe('~');
  });
});
