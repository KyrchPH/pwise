import crypto from 'node:crypto';
import { env } from '../config/env.js';
import ApiError from './ApiError.js';

// AES-256-GCM at-rest encryption for sensitive connection credentials (Facebook
// app secret, client token, page access token). Stored as "iv.tag.ciphertext"
// (all base64). The key comes from ENCRYPTION_KEY — 64 hex chars (openssl rand
// -hex 32) or base64; anything else is hashed to 32 bytes as a fallback.
const ALGO = 'aes-256-gcm';

function key() {
  const k = env.encryptionKey;
  if (!k) throw new ApiError(503, 'Encryption is not configured (ENCRYPTION_KEY missing)');
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  const b64 = Buffer.from(k, 'base64');
  if (b64.length === 32) return b64;
  return crypto.createHash('sha256').update(String(k)).digest(); // derive 32 bytes
}

// Returns null for empty input so optional fields stay null in the DB.
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new ApiError(500, 'malformed encrypted value');
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
