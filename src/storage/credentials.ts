const SERVICE = 'ssh-cli';

export type CredentialKind = 'password' | 'passphrase';

function secretName(connectionId: string, kind: CredentialKind): string {
  // A UUID is used as the connection id, so this is stable and collision-free.
  return `${connectionId}:${kind}`;
}

function assertSecretsAvailable(): void {
  if (typeof Bun === 'undefined' || !Bun.secrets) {
    throw new Error('OS credential storage is not available in this runtime');
  }
}

function keychainError(action: string, err: unknown): Error {
  const reason = err instanceof Error ? err.message : String(err);
  return new Error(`OS keychain ${action} failed: ${reason}`);
}

export async function getCredential(
  connectionId: string,
  kind: CredentialKind,
): Promise<string | null> {
  assertSecretsAvailable();
  try {
    return await Bun.secrets.get({ service: SERVICE, name: secretName(connectionId, kind) });
  } catch (err) {
    throw keychainError('read', err);
  }
}

/**
 * Store or clear a credential. An empty/undefined value deletes the entry so
 * switching auth type does not leave an old password in the keychain.
 */
export async function setCredential(
  connectionId: string,
  kind: CredentialKind,
  value: string | undefined,
): Promise<void> {
  assertSecretsAvailable();
  try {
    if (!value) {
      await Bun.secrets.delete({ service: SERVICE, name: secretName(connectionId, kind) });
      return;
    }
    await Bun.secrets.set({
      service: SERVICE,
      name: secretName(connectionId, kind),
      value,
    });
  } catch (err) {
    throw keychainError(value ? 'write' : 'delete', err);
  }
}

/** Best-effort cleanup when a connection is deleted. */
export async function deleteConnectionCredentials(connectionId: string): Promise<void> {
  if (typeof Bun === 'undefined' || !Bun.secrets) return;
  await Promise.allSettled([
    Bun.secrets.delete({ service: SERVICE, name: secretName(connectionId, 'password') }),
    Bun.secrets.delete({ service: SERVICE, name: secretName(connectionId, 'passphrase') }),
  ]);
}
