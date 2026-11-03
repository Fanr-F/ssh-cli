import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { SshConnection } from '../../src/ssh/connection';
import { SshConnectionState } from '../../src/ssh/types';

interface FakeClient extends EventEmitter {
  endCalls: number;
  destroyCalls: number;
  end: () => void;
  destroy: () => void;
}

function createClient(): FakeClient {
  const client = new EventEmitter() as FakeClient;
  client.endCalls = 0;
  client.destroyCalls = 0;
  client.end = () => {
    client.endCalls += 1;
    queueMicrotask(() => client.emit('close'));
  };
  client.destroy = () => {
    client.destroyCalls += 1;
    queueMicrotask(() => client.emit('close'));
  };
  return client;
}

function fakeConnection(
  timeoutMs: number,
  client: FakeClient = createClient(),
): { conn: SshConnection; client: FakeClient } {
  const conn = new SshConnection(timeoutMs);
  (conn as any).client = client;
  (conn as any)._state = SshConnectionState.Connected;
  return { conn, client };
}

describe('SshConnection error handling', () => {
  test('does not throw when no error listener is registered', () => {
    const { conn, client } = fakeConnection(500);
    (conn as any).setupClientHandlers(client);

    const err = new Error('boom');
    expect(() => client.emit('error', err)).not.toThrow();
    expect(conn.getLastError()).toBe(err);
  });

  test('forwards the error once when a listener exists', () => {
    const { conn, client } = fakeConnection(500);
    (conn as any).setupClientHandlers(client);

    const received: Error[] = [];
    conn.on('error', (err) => received.push(err));

    const err = new Error('network down');
    client.emit('error', err);

    expect(received).toEqual([err]);
    expect(conn.getLastError()).toBe(err);
  });

  test('ignores errors from a client that is no longer current', () => {
    const { conn, client: oldClient } = fakeConnection(500);
    (conn as any).setupClientHandlers(oldClient);

    const newClient = createClient();
    (conn as any).client = newClient;
    const received: Error[] = [];
    conn.on('error', (err) => received.push(err));

    oldClient.emit('error', new Error('stale'));

    expect(received).toEqual([]);
    expect(conn.getLastError()).toBeNull();
  });
});

describe('SshConnection.disconnect', () => {
  test('resolves when the client emits close', async () => {
    const { conn, client } = fakeConnection(500);

    await conn.disconnect();

    expect(conn.state).toBe(SshConnectionState.Disconnected);
    expect(client.endCalls).toBe(1);
  });

  test('closes a client whose end event already arrived', async () => {
    const { conn, client } = fakeConnection(500);
    (conn as any).setupClientHandlers(client);

    client.emit('end');
    expect(conn.state).toBe(SshConnectionState.Disconnected);

    await conn.disconnect();

    expect(client.endCalls).toBe(1);
    expect(conn.state).toBe(SshConnectionState.Disconnected);
    expect((conn as any).client).toBeNull();
  });

  test('destroys the transport after the timeout', async () => {
    const { conn, client } = fakeConnection(10);
    // Half-closed transport: end() never produces a close event.
    client.end = () => {
      client.endCalls += 1;
    };

    await conn.disconnect();

    expect(client.destroyCalls).toBe(1);
    expect(conn.state).toBe(SshConnectionState.Disconnected);
  });

  test('late events from an old client do not reset a new connection', () => {
    const { conn, client: oldClient } = fakeConnection(500);
    (conn as any).setupClientHandlers(oldClient);

    const newClient = createClient();
    (conn as any).client = newClient;
    (conn as any)._state = SshConnectionState.Connected;

    oldClient.emit('end');
    oldClient.emit('close');

    expect(conn.state).toBe(SshConnectionState.Connected);
    expect((conn as any).client).toBe(newClient);
  });
});
