import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';

let privateKey = config.jwt.privateKey;
let publicKey = config.jwt.publicKey;

// Dynamic self-healing keys for local development or testing when keys are dummy/placeholders
const isDummyKey = 
  !privateKey || 
  !privateKey.startsWith('-----BEGIN') || 
  privateKey.includes('placeholder') || 
  privateKey.includes('dummy') ||
  privateKey.includes('test');

if (isDummyKey) {
  if (config.server.env !== 'test') {
    console.warn('⚠️ JWT_PRIVATE_KEY is not a valid PEM RSA key. Generating a dynamic 2048-bit RSA key pair for local development...');
  }
  const { privateKey: genPriv, publicKey: genPub } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = genPriv;
  publicKey = genPub;
}

export interface JwtPayload {
  sub: string;         // userId
  email: string;       // user email
  orgId: string;       // active organizationId
  role: string;        // org-level role
  type: 'access';      // token type
  jti: string;         // JWT ID for blocklisting
}

/**
 * Signs an RS256 JWT using the private RSA key.
 */
export function signAccessToken(payload: Omit<JwtPayload, 'type' | 'jti'> & { jti?: string }): string {
  const tokenPayload: JwtPayload = {
    ...payload,
    type: 'access',
    jti: payload.jti || crypto.randomUUID(),
  };

  return jwt.sign(tokenPayload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer: 'seladev',
  });
}

/**
 * Verifies an RS256 JWT using the public RSA key.
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'seladev',
  }) as JwtPayload;
}
