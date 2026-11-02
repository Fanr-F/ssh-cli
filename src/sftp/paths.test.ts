import { describe, expect, test } from 'bun:test';
import { remoteParentPath, resolveRemotePath } from './paths';

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
