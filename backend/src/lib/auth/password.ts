// ═══════════════════════════════════════════════════════════
// T4 passwords — argon2id (OWASP parameters), policy validation,
// constant-time dummy verification, automatic rehash.
// ═══════════════════════════════════════════════════════════

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { z } from 'zod'

// OWASP minimum: 19 MiB memory, 2 iterations, 1 thread, Argon2id.
// (algorithm: 2 = Algorithm.Argon2id — a const enum, so passed numerically
// to stay compatible with isolatedModules; it is node-rs's default too.)
export const ARGON2_OPTS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

const PHC_PARAMS_RE = /\$m=(\d+),t=(\d+),p=(\d+)\$/

/** Embedded top-100 common-password list (case-insensitive check, no external file). */
const COMMON_PASSWORDS = new Set([
  '123456', 'password', '123456789', '12345678', '12345', 'qwerty', '1234567890', '1234567',
  '111111', '123123', 'abc123', '1234', 'password1', 'iloveyou', '000000', 'qwerty123',
  '1q2w3e', 'aa12345678', '654321', '555555', 'dragon', 'soccer', 'baseball', 'football',
  'monkey', 'letmein', '696969', 'shadow', 'master', '666666', 'qwertyuiop', '123321',
  'mustang', '123abc', '121212', 'flower', 'hello', 'charlie', 'sunshine', 'princess',
  'admin', 'welcome', 'login', 'passw0rd', 'password123', 'qwerty1', 'solo', 'starwars',
  'lovely', 'whatever', 'zaq12wsx', '1qaz2wsx', 'test123', 'asdfgh', 'zxcvbnm', 'qwe123',
  'abcd1234', '1234qwer', 'q1w2e3r4', '12341234', 'access', 'love', 'secret', 'summer',
  'winter', 'spring', 'autumn', 'admin123', 'administrator', 'root', 'toor', 'letmein1',
  'trustno1', 'hunter2', 'batman', 'superman', 'pokemon', 'samsung', 'google', 'facebook',
  'youtube', 'ninja', 'azerty', 'asdf', 'zxcv', '123654', '123qwe', 'michael', 'jordan',
  'harley', 'ranger', 'buster', 'thomas', 'tigger', 'robert', 'soccer1', 'hockey',
  'killer', 'george', 'sexy', 'andrew', 'charlie1', 'jennifer', 'freedom', 'pepper',
  '1111', '5555', '2000', '1990', '12345678910', 'google1', 'password12', 'qwerty12',
])

export interface PasswordCheck {
  ok: boolean
  reason?: string
}

/** Password policy: length 12–128, no brand/local-part substrings, not a top-100 password. */
export function checkPasswordPolicy(password: string, email?: string): PasswordCheck {
  if (typeof password !== 'string' || password.length < 12) {
    return { ok: false, reason: 'Password must be at least 12 characters' }
  }
  if (password.length > 128) {
    return { ok: false, reason: 'Password must be at most 128 characters' }
  }
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, reason: 'Password is too common — choose something unique' }
  }
  if (lower.includes('sibra')) {
    return { ok: false, reason: 'Password must not contain the brand name' }
  }
  if (email) {
    const local = email.split('@')[0]?.toLowerCase() ?? ''
    if (local.length >= 3 && lower.includes(local)) {
      return { ok: false, reason: 'Password must not contain your email name' }
    }
  }
  return { ok: true }
}

/** Zod schema for password fields — strict, single source of the policy. */
export function passwordSchema(email?: string) {
  return z
    .string()
    .max(128, 'Password must be at most 128 characters')
    .refine((v) => checkPasswordPolicy(v, email).ok, (v) => ({
      message: checkPasswordPolicy(v, email).reason ?? 'Password does not meet the policy',
    }))
}

/** Hash a password with argon2id (OWASP params). */
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTS)
}

/**
 * Constant-time verification helper: when the user does not exist we still
 * verify against a module-level dummy hash so response timing cannot reveal
 * whether an email is registered.
 */
const DUMMY_HASH_SEED = 'sibra-t4-dummy-verify-seed-9f3a1c'
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = argonHash(DUMMY_HASH_SEED, ARGON2_OPTS)
  return dummyHashPromise
}

export async function verifyPasswordAgainstDummy(password: string): Promise<void> {
  await argonVerify(await dummyHash(), password).catch(() => false)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password)
  } catch {
    return false
  }
}

/**
 * Rehash when the stored PHC string's parameters are weaker than the current
 * OWASP target (argon2 PHC strings are self-describing).
 */
export function needsRehash(passwordHash: string): boolean {
  const m = PHC_PARAMS_RE.exec(passwordHash)
  if (!m) return true
  const [, mm, tt, pp] = m
  return (
    Number(mm) < ARGON2_OPTS.memoryCost ||
    Number(tt) < ARGON2_OPTS.timeCost ||
    Number(pp) < ARGON2_OPTS.parallelism
  )
}
