// ═══════════════════════════════════════════════════════════
// Password hashing + policy (OWASP-aligned).
// • argon2id via @node-rs/argon2 (prebuilt serverless binaries):
//   memory 19 MiB, time 2, parallelism 1
// • Constant-time verification: unknown users verify against a
//   precomputed DUMMY_HASH so response timing never reveals
//   whether the email exists.
// • Automatic rehash when parameters change.
// • Policy: ≥12 chars (≤128), reject common passwords (embedded
//   list), reject passwords containing the email local-part or
//   brand terms. No composition rules; paste is allowed.
// ═══════════════════════════════════════════════════════════

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { checkCommonPassword } from '@/lib/common-passwords'

// Algorithm.Argon2id (=2). The package exports it as an ambient
// const enum which cannot be value-imported under isolatedModules —
// mirror the numeric value with a type-only reference instead.
type Argon2Algorithm = 0 | 1 | 2
const ARGON_OPTS = {
  algorithm: 2 satisfies Argon2Algorithm as import('@node-rs/argon2').Algorithm,
  memoryCost: 19456, // 19 MiB (OWASP minimum)
  timeCost: 2,
  parallelism: 1,
} as const

/** Precomputed argon2id hash of an unguessable random value — used when the user does not exist. */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$BNuTwfL3UXjrfy1OixI3Cw$QQ6i0wzw5w/a9lej/FfBEuL/DR3jyfdInEHx+JnOIDE'

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS)
}

/** Verify against a real hash, or burn the same CPU against DUMMY_HASH for unknown users. */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  try {
    return await argonVerify(hash ?? DUMMY_HASH, password)
  } catch {
    return false
  }
}

/**
 * True when the stored PHC string was produced with weaker/different
 * parameters than the current policy → the caller should rehash.
 */
export function needsRehash(hash: string): boolean {
  const m = hash.match(/\$m=(\d+),t=(\d+),p=(\d+)/)
  if (!m) return false
  const [, mem, time, par] = m
  return Number(mem) !== ARGON_OPTS.memoryCost || Number(time) !== ARGON_OPTS.timeCost || Number(par) !== ARGON_OPTS.parallelism
}

export interface PasswordPolicyResult {
  ok: boolean
  errors: string[]
}

const BRAND_TERMS = ['sibra', 'digital hub', 'digitalkidosphere', 'kidosphere', 'atharva', 'creator hub', 'creatorhub', 'admin']

/** Enforce the §3.3 policy. `email` is the account's email (local-part checked). */
export function validatePasswordPolicy(password: string, email: string): PasswordPolicyResult {
  const errors: string[] = []
  const pw = password
  const lower = pw.toLowerCase()

  if (pw.length < 12) errors.push('Use at least 12 characters.')
  if (pw.length > 128) errors.push('Maximum 128 characters.')
  if (checkCommonPassword(pw).common) errors.push('This password appears on common-password lists — choose something unique.')

  const emailLocal = email.split('@')[0]?.toLowerCase() ?? ''
  if (emailLocal.length >= 4 && lower.includes(emailLocal)) {
    errors.push('Password must not contain your email name.')
  }
  if (BRAND_TERMS.some((term) => lower.includes(term))) {
    errors.push('Password must not contain brand or role names.')
  }
  if (/^(.)\1+$/.test(pw)) errors.push('Password must not be a single repeated character.')

  return { ok: errors.length === 0, errors }
}
