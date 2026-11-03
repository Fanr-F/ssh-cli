import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConnectConfig, discoverDefaultKey } from '../../src/ssh/auth';
import type { ConnectionConfig } from '../../src/types/connection';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'c1',
    name: 'Prod',
    host: 'example.com',
    port: 22,
    username: 'root',
    authType: 'key',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function homeWithKey(content = 'PRIVATE-KEY'): Promise<{ home: string; keyPath: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ssh-cli-auth-'));
  tempDirs.push(home);
  await mkdir(join(home, '.ssh'), { recursive: true });
  const keyPath = join(home, '.ssh', 'id_ed25519');
  await writeFile(keyPath, content, 'utf-8');
  return { home, keyPath };
}

async function emptyHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'ssh-cli-auth-'));
  tempDirs.push(home);
  return home;
}

describe('buildConnectConfig', () => {
  test('reads an explicit key file asynchronously', async () => {
    const { home, keyPath } = await homeWithKey();
    const config = await buildConnectConfig(
      connection({ privateKeyPath: keyPath, passphrase: 'secret' }),
      { homeDir: home, env: {} },
    );

    expect(Buffer.isBuffer(config.privateKey)).toBe(true);
    expect(config.privateKey?.toString()).toBe('PRIVATE-KEY');
    expect(config.passphrase).toBe('secret');
  });

  test('expands ~ using the supplied home directory', async () => {
    const { home } = await homeWithKey();
    const config = await buildConnectConfig(
      connection({ privateKeyPath: '~/.ssh/id_ed25519' }),
      { homeDir: home, env: {} },
    );

    expect(config.privateKey?.toString()).toBe('PRIVATE-KEY');
  });

  test('discovers a default key when no path is configured', async () => {
    const { home, keyPath } = await homeWithKey();

    expect(discoverDefaultKey(home)).toBe(keyPath);
    const config = await buildConnectConfig(
      connection({ privateKeyPath: undefined }),
      { homeDir: home, env: {} },
    );
    expect(config.privateKey?.toString()).toBe('PRIVATE-KEY');
  });

  test('caches the parsed key by path and mtime', async () => {
    const { home, keyPath } = await homeWithKey();
    const first = await buildConnectConfig(connection({ privateKeyPath: keyPath }), { homeDir: home });
    const second = await buildConnectConfig(connection({ privateKeyPath: keyPath }), { homeDir: home });

    // Same Buffer instance: the file was not read again.
    expect(second.privateKey).toBe(first.privateKey);
  });

  test('falls back to ssh-agent when no key exists', async () => {
    const home = await emptyHome();
    const config = await buildConnectConfig(
      connection({ privateKeyPath: undefined }),
      { homeDir: home, env: { SSH_AUTH_SOCK: '/tmp/agent.sock' } },
    );

    expect(config.agent).toBe('/tmp/agent.sock');
    expect(config.privateKey).toBeUndefined();
  });

  test('fails with a clear error when no key and no agent are available', async () => {
    const home = await emptyHome();
    await expect(
      buildConnectConfig(connection({ privateKeyPath: undefined }), { homeDir: home, env: {} }),
    ).rejects.toThrow('No SSH private key found');
  });

  test('reports an unreadable configured key', async () => {
    const home = await emptyHome();
    await expect(
      buildConnectConfig(connection({ privateKeyPath: join(home, 'missing') }), { homeDir: home }),
    ).rejects.toThrow('Could not read private key');
  });

  test('sets the password for password auth', async () => {
    const config = await buildConnectConfig(
      connection({ authType: 'password', password: 'hunter2' }),
      { homeDir: '/nonexistent', env: {} },
    );
    expect(config.password).toBe('hunter2');
  });
});
