// ═══════════════════════════════════════════════════════════
// Single-use recovery codes — the offline second factor.
// • 10 codes, 16 chars of Crockford base32 each (80 bits),
//   displayed as XXXX-XXXX-XXXX-XXXX exactly once
// • Stored only as HMAC-SHA256(SESSION_PEPPER, code)
// • Consuming a code removes its hash; regeneration invalidates
//   all older codes; owners are warned when ≤ 3 remain
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto'
import { getEnv } from '@/lib/env'
import { timingSafeEqual } from '@/lib/crypto'

// Crockford base32: no I, L, O, U (confusable letters excluded).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 16
const GROUPS = 4

/** Generate one 16-char Crockford base32 code, formatted XXXX-XXXX-XXXX-XXXX. */
function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let raw = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CROCKFORD[bytes[i] % 32]
  }
  return raw.match(new RegExp(`.{1,${CODE_LENGTH / GROUPS}}`, 'g'))!.join('-')
}

/** Normalize user input: uppercase, strip separators, Crockford-confusable mapping (O→0, I/L→1). */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, CODE_LENGTH)
}

export function recoveryCodeHash(code: string): string {
  const { SESSION_PEPPER } = getEnv()
  return crypto.createHmac('sha256', SESSION_PEPPER).update(normalizeRecoveryCode(code), 'utf8').digest('hex')
}

/** Generate a fresh set of 10 codes — plaintext shown ONCE to the admin. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => generateCode())
}

/** Store-side form: hashes only. */
export function hashesFor(codes: string[]): string[] {
  return codes.map(recoveryCodeHash)
}

/**
 * Try to consume `input` against the stored hash list.
 * Returns the updated list (matched hash removed) or null when no match.
 */
export function consumeRecoveryCode(input: string, storedHashes: string[]): string[] | null {
  const candidate = recoveryCodeHash(input)
  let matchedIndex = -1
  for (let i = 0; i < storedHashes.length; i++) {
    if (timingSafeEqual(storedHashes[i], candidate)) {
      matchedIndex = i
      break
    }
  }
  if (matchedIndex === -1) return null
  return storedHashes.filter((_, i) => i !== matchedIndex)
}

export const RECOVERY_CODES_TOTAL = 10
export const RECOVERY_CODES_LOW_THRESHOLD = 3
