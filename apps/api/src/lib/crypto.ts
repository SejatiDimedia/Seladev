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

import { config } from '../config';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a derived key.
 * Falls back to 'platform' as organizationId if not provided.
 */
export function encryptGcm(plaintext: string, organizationId = 'platform'): EncryptedPayload {
  const masterKey = config.security.masterEncryptionKey;
  const derivedKey = deriveOrgKey(masterKey, organizationId);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts an AES-256-GCM payload using the derived key.
 * Falls back to 'platform' as organizationId if not provided.
 */
export function decryptGcm(payload: EncryptedPayload, organizationId = 'platform'): string {
  const masterKey = config.security.masterEncryptionKey;
  const derivedKey = deriveOrgKey(masterKey, organizationId);
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

