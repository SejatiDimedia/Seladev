import bcrypt from 'bcrypt';
import crypto from 'crypto';

/**
 * Hashes a plaintext password using bcrypt with 12 rounds.
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Compares a plaintext password against a bcrypt hash.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generates a cryptographically secure random token (hex string).
 */
export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Computes the SHA-256 hash of a string.
 */
export function hashSha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Derives a deterministic organization-specific key using HMAC-SHA256
 * from the master key and the organization ID.
 */
export function deriveOrgKey(masterKeyHex: string, organizationId: string): Buffer {
  const masterKey = Buffer.from(masterKeyHex, 'utf-8');
  return crypto.createHmac('sha256', masterKey)
    .update(organizationId)
    .digest();
}
