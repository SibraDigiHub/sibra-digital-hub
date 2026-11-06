// ═══════════════════════════════════════════════════════════
// T4 auth primitives — hashing, encryption, tokens, hashed IPs/UAs.
// Everything here is deliberately low-level and dependency-free
// (node:crypto only) so every auth module can share one source
// of truth. Secrets never leave this module in the clear.
// ═══════════════════════════════════════════════════════════

import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto'

// ── Key material ─────────────────────────────────────────────

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes')
  return key
}

export function sessionPepper(): string {
  const pepper = process.env.SESSION_PEPPER
  if (!pepper || Buffer.from(pepper).length < 32) {
    throw new Error('SESSION_PEPPER is not configured (≥32 bytes required)')
  }
  return pepper
}

// ── Hashes ───────────────────────────────────────────────────

/** sha256 hex — token storage (session/reset tokens are only ever stored hashed). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** HMAC-SHA256 hex — salted hashes with the SESSION_PEPPER. */
export function hmacHex(input: string): string {
  return createHmac('sha256', sessionPepper()).update(input).digest('hex')
}

/** Salted IP hash — IPs are never stored in clear in T4 tables. */
export function hashIp(ip: string): string {
  return hmacHex(`ip:${ip}`)
}

/** Salted user-agent hash — sessions are soft-bound to it. */
export function hashUa(ua: string): string {
  return hmacHex(`ua:${ua}`)
}

/** Constant-time comparison of two hex/ascii strings. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length || ab.length === 0) return false
  return timingSafeEqual(ab, bb)
}

// ── Random tokens ────────────────────────────────────────────

/** Opaque 32-byte token, base64url — the only form that ever reaches a cookie. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

/** n random bytes as base64url. */
export function randomBase64url(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

// ── AES-256-GCM (TOTP secrets at rest) ──────────────────────
// Ciphertext format: v1.<iv>.<ct>.<tag>  (base64url parts, unique IV per value)

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${tag.toString('base64url')}`
}

export function decryptSecret(enc: string): string {
  const parts = enc.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('invalid ciphertext format')
  const iv = Buffer.from(parts[1], 'base64url')
  const ct = Buffer.from(parts[2], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// ── Crockford base32 (recovery codes) ───────────────────────
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 16 chars of Crockford base32 (80 bits), displayed as XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += CROCKFORD[bytes[i] % 32]
  return out
}

export function formatRecoveryCode(raw: string): string {
  return raw.replace(/(.{4})(?=.)/g, '$1-')
}

/** Normalise typed recovery codes: strip separators, uppercase, fix common substitutions. */
export function normaliseRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

/** Recovery codes are stored ONLY as HMAC-SHA256(SESSION_PEPPER, code). */
export function recoveryCodeHash(normalisedCode: string): string {
  return hmacHex(`rc:${normalisedCode}`)
}
