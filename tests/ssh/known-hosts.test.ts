import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fingerprintHostKey,
  KnownHostsStore,
  knownHostKeyId,
  parseKnownHosts,
} from '../../src/ssh/known-hosts';

const tempDirs: string[] = [];

async function tempStore(): Promise<{ store: KnownHostsStore; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ssh-cli-known-hosts-'));
  tempDirs.push(dir);
  const file = join(dir, 'known_hosts.json');
  return { store: new KnownHostsStore(file), file };
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('host key helpers', () => {
  test('formats IPv4 and IPv6 host ids', () => {
    expect(knownHostKeyId('example.com', 22)).toBe('example.com:22');
    expect(knownHostKeyId('::1', 2222)).toBe('[::1]:2222');
  });

  test('produces a stable OpenSSH-style fingerprint', () => {
    const key = Buffer.from('host-key');
    expect(fingerprintHostKey(key)).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fingerprintHostKey(key)).toBe(fingerprintHostKey(Buffer.from('host-key')));
  });

  test('rejects malformed files', () => {
    expect(() => parseKnownHosts('[]')).toThrow('JSON object');
    expect(() => parseKnownHosts('{"host:22":{"fingerprint":"x"}}')).toThrow('Invalid');
  });
});

describe('KnownHostsStore', () => {
  test('pins a new key, trusts the same key, and rejects a changed key', async () => {
    const { store } = await tempStore();
    const keyA = Buffer.from('key-a');
    const keyB = Buffer.from('key-b');

    const first = await store.verify('example.com', 22, keyA);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.status).toBe('new');

    const second = await store.verify('example.com', 22, keyA);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.status).toBe('trusted');

    const changed = await store.verify('example.com', 22, keyB);
    expect(changed.ok).toBe(false);
    if (!changed.ok) {
      expect(changed.status).toBe('mismatch');
      expect(changed.expected).toBe(fingerprintHostKey(keyA));
      expect(changed.fingerprint).toBe(fingerprintHostKey(keyB));
    }
  });

  test('fails closed when the store is corrupt', async () => {
    const { store, file } = await tempStore();
    await writeFile(file, '{broken', 'utf-8');

    const result = await store.verify('example.com', 22, Buffer.from('key'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe('error');
  });

  test('refreshes a stale lastSeen but not on every trusted check', async () => {
    const { store, file } = await tempStore();
    const key = Buffer.from('key-a');
    const id = knownHostKeyId('example.com', 22);

    await store.verify('example.com', 22, key);
    const initial = JSON.parse(await readFile(file, 'utf-8'));
    expect(initial[id].lastSeen).toBe(initial[id].firstSeen);
    const firstSeen = initial[id].firstSeen;

    // Pretend the entry was last seen long ago.
    initial[id].lastSeen = '2020-01-01T00:00:00.000Z';
    await writeFile(file, JSON.stringify(initial), 'utf-8');

    const second = await store.verify('example.com', 22, key);
    expect(second.ok).toBe(true);
    const refreshed = JSON.parse(await readFile(file, 'utf-8'));
    expect(refreshed[id].lastSeen).not.toBe('2020-01-01T00:00:00.000Z');
    expect(refreshed[id].firstSeen).toBe(firstSeen);

    // A second immediate check is throttled: no further rewrite occurs.
    await store.verify('example.com', 22, key);
    const throttled = JSON.parse(await readFile(file, 'utf-8'));
    expect(throttled[id].lastSeen).toBe(refreshed[id].lastSeen);
  });
});
