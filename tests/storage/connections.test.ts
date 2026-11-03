import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectionStore, type CredentialStore } from '../../src/storage/connections';
import type { ConnectionConfig } from '../../src/types/connection';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

interface MemoryCredentials extends CredentialStore {
  secrets: Map<string, string>;
}

function memoryCredentials(): MemoryCredentials {
  const secrets = new Map<string, string>();
  const key = (id: string, kind: string) => `${id}:${kind}`;
  return {
    secrets,
    get: async (id, kind) => secrets.get(key(id, kind)) ?? null,
    set: async (id, kind, value) => {
      if (!value) secrets.delete(key(id, kind));
      else secrets.set(key(id, kind), value);
    },
    deleteAll: async (id) => {
      secrets.delete(key(id, 'password'));
      secrets.delete(key(id, 'passphrase'));
    },
  };
}

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'c1',
    name: 'Prod',
    host: 'example.com',
    port: 22,
    username: 'root',
    authType: 'password',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function setup(options: { raw?: Partial<ConnectionConfig>[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ssh-cli-store-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'config.json');
  if (options.raw) {
    await writeFile(configPath, JSON.stringify(options.raw), 'utf-8');
  }

  const credentials = memoryCredentials();
  const state = { failWrites: false, writes: 0 };
  const store = new ConnectionStore({
    configPath,
    credentials,
    writeFile: async (path, contents) => {
      state.writes += 1;
      if (state.failWrites) throw new Error('disk full');
      await writeFile(path, contents, 'utf-8');
    },
  });

  return { store, credentials, state, configPath };
}

describe('ConnectionStore.update', () => {
  test('restores the previous credential when the config write fails', async () => {
    const { store, credentials, state } = await setup({ raw: [connection()] });
    await store.getAll();
    credentials.secrets.set('c1:password', 'old-secret');

    state.failWrites = true;
    await expect(store.update('c1', { password: 'new-secret' })).rejects.toThrow('disk full');

    expect(credentials.secrets.get('c1:password')).toBe('old-secret');
    expect(state.failWrites).toBe(true);
  });

  test('removes a credential that did not exist before when the write fails', async () => {
    const { store, credentials, state } = await setup({ raw: [connection({ authType: 'key' })] });
    await store.getAll();

    state.failWrites = true;
    await expect(
      store.update('c1', { authType: 'password', password: 'new-secret' }),
    ).rejects.toThrow('disk full');

    expect(credentials.secrets.has('c1:password')).toBe(false);
  });

  test('writes the new credential and clears the stale auth type on success', async () => {
    const { store, credentials, configPath } = await setup({ raw: [connection()] });
    await store.getAll();
    credentials.secrets.set('c1:password', 'old-secret');

    await store.update('c1', { authType: 'key', privateKeyPath: '~/.ssh/id_ed25519' });

    expect(credentials.secrets.has('c1:password')).toBe(false);
    const onDisk = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(onDisk[0].authType).toBe('key');
    expect(JSON.stringify(onDisk)).not.toContain('old-secret');
  });
});

describe('ConnectionStore legacy migration', () => {
  test('moves plaintext credentials into the keychain and out of the file', async () => {
    const { store, credentials, configPath } = await setup({
      raw: [{ ...connection({ authType: 'password' }), password: 'legacy-secret' }],
    });

    const [loaded] = await store.getAll();

    expect(loaded?.password).toBeUndefined();
    expect(credentials.secrets.get('c1:password')).toBe('legacy-secret');
    const raw = await readFile(configPath, 'utf-8');
    expect(raw).not.toContain('legacy-secret');
  });

  test('keeps migrated entries when a new connection is added', async () => {
    const { store, credentials } = await setup({
      raw: [{ ...connection({ authType: 'password' }), password: 'legacy-secret' }],
    });

    await store.getAll();
    await store.add(connection({
      id: 'c2',
      name: 'Staging',
      host: 'staging.example.com',
      authType: 'password',
      password: 'new-secret',
    }));

    const all = await store.getAll();
    expect(all.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(credentials.secrets.get('c1:password')).toBe('legacy-secret');
    expect(credentials.secrets.get('c2:password')).toBe('new-secret');
  });
});
