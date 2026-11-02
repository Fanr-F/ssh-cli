import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { SshConnection } from './connection';
import { SshConnectionState } from './types';

function fakeConnection(timeoutMs: number): { conn: SshConnection; client: EventEmitter & { end: () => void } } {
  const conn = new SshConnection(timeoutMs);
  const client = Object.assign(new EventEmitter(), { end: () => {} });
  (conn as any).client = client;
  (conn as any)._state = SshConnectionState.Connected;
  return { conn, client };
}

describe('SshConnection.disconnect', () => {
  test('resolves when the client emits close', async () => {
    const { conn, client } = fakeConnection(500);
    client.end = () => queueMicrotask(() => client.emit('close'));

    await conn.disconnect();

    expect(conn.state).toBe(SshConnectionState.Disconnected);
  });

  test('resolves after the timeout when close never arrives', async () => {
    const { conn } = fakeConnection(20);
    const started = Date.now();

    await conn.disconnect();

    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(conn.state).toBe(SshConnectionState.Disconnected);
  });
});
