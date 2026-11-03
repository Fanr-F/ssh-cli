import { SshConnection } from '../ssh/connection';
import type { ConnectionStore } from '../storage/connections';
import type { ConnectionConfig } from '../types/connection';

/**
 * Resolve credentials, create an SshConnection and connect it.
 *
 * `configure` runs before `connect()` so callers can subscribe to `error` /
 * `close` (an ssh2 error emitted with no listener would kill the process).
 */
export async function createSshSession(
  store: ConnectionStore,
  config: ConnectionConfig,
  configure?: (ssh: SshConnection) => void,
): Promise<SshConnection> {
  const authConfig = await store.withCredentials(config);
  const ssh = new SshConnection();
  configure?.(ssh);
  await ssh.connect(authConfig);
  return ssh;
}
