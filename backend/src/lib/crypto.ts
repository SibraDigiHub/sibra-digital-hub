// ═══════════════════════════════════════════════════════════
// Crypto primitives for admin auth.
// • SHA-256 for opaque token storage (token itself is 32 random
//   bytes, only its hash ever touches the database)
// • HMAC-SHA256 with SESSION_PEPPER for IPs / UAs / recovery codes
// • AES-256-GCM (unique IV + auth tag) for TOTP secrets at rest
// • Constant-time comparisons for every secret check
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto'
import { getEnv } from '@/lib/env'

/** 32 random bytes → base64url (opaque session / reset token). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** Plain SHA-256 hex — for session/reset-token storage. */
export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Salted HMAC-SHA256 hex (SESSION_PEPPER) — IPs, user agents, recovery codes. */
export function pepperHash(value: string): string {
  const { SESSION_PEPPER } = getEnv()
  return crypto.createHmac('sha256', SESSION_PEPPER).update(value, 'utf8').digest('hex')
}

/** Constant-time hex/string comparison (length-safe). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // Compare against self to keep timing uniform, then fail.
    crypto.timingSafeEqual(ab, ab)
    return false
  }
  return crypto.timingSafeEqual(ab, bb)
}

// ── AES-256-GCM (TOTP secrets at rest) ─────────────────────

function encryptionKeyBytes(): Buffer {
  const { ENCRYPTION_KEY } = getEnv()
  const key = Buffer.from(ENCRYPTION_KEY, 'base64')
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)')
  return key
}

/** Encrypt a secret → "v1:<iv_b64>:<ciphertext_b64>:<tag_b64>" (unique IV). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKeyBytes(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`
}

/** Decrypt "v1:…" ciphertext. Throws on tampering (auth-tag mismatch). */
export function decryptSecret(payload: string): string {
  const [version, ivB64, ctB64, tagB64] = payload.split(':')
  if (version !== 'v1' || !ivB64 || !ctB64 || !tagB64) {
    throw new Error('Invalid ciphertext envelope')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKeyBytes(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return pt.toString('utf8')
}

/** Coarse, non-sensitive device summary for the sessions list ("Chrome · Linux"). */
export function deviceLabelFromUa(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /curl|wget|node|postman/i.test(ua) ? 'CLI client'
    : 'Browser'
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown OS'
  return `${browser} · ${os}`
}
