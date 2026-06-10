import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits (recommended for GCM)
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ITERATIONS = 100_000;
const DIGEST = 'sha256';

/**
 * Derive a 256-bit key from a master password using PBKDF2.
 */
export function deriveKey(masterPassword: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterPassword, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns: base64(salt(16) + iv(12) + ciphertext + authTag(16))
 */
export function encrypt(plaintext: string, masterPassword: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterPassword, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: salt || iv || ciphertext || authTag
  const payload = Buffer.concat([salt, iv, encrypted, authTag]);
  return payload.toString('base64');
}

/**
 * Decrypt ciphertext that was encrypted with encrypt().
 * Throws if the master password is wrong or data is corrupted.
 */
export function decrypt(ciphertext: string, masterPassword: string): string {
  const payload = Buffer.from(ciphertext, 'base64');

  const salt = payload.subarray(0, SALT_LENGTH);
  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(SALT_LENGTH + IV_LENGTH, payload.length - AUTH_TAG_LENGTH);

  const key = deriveKey(masterPassword, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
