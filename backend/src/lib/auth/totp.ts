// ═══════════════════════════════════════════════════════════
// T4 TOTP — RFC 6238 via otplib v13, SHA-1 / 6 digits / 30 s.
// Accepts ±1 step. Returns the MATCHED step so the service can
// enforce replay protection (reject step ≤ lastTotpStep).
// Secret: 160-bit, generated server-side (otplib generateSecret).
// ═══════════════════════════════════════════════════════════

import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateURI } from 'otplib'

const totp = new TOTP({
  digits: 6,
  period: 30,
  algorithm: 'sha1',
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
})

/** 160-bit secret as base32 (RFC 4648, no padding). */
export function totpGenerateSecret(): string {
  return generateSecret({ length: 20 })
}

export function totpKeyUri(email: string, secret: string): string {
  return generateURI({
    strategy: 'totp',
    secret,
    label: email,
    issuer: process.env.ADMIN_WEBAUTHN_RP_NAME || 'Sibra Digital Hub',
    digits: 6,
    period: 30,
    algorithm: 'sha1',
  })
}

export function currentTotpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / 30)
}

export interface TotpCheck {
  ok: boolean
  /** Matched 30-second step (only when ok) — feed into lastTotpStep replay guard. */
  step?: number
}

/**
 * Verify a 6-digit TOTP code, accepting ±1 step. Returns the matched step so
 * the caller can enforce monotonic replay protection.
 */
export async function totpVerify(secret: string, token: string, now = Date.now()): Promise<TotpCheck> {
  const clean = (token ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return { ok: false }
  const base = currentTotpStep(now)
  // Scan +1 → -1 so a code from the CURRENT step wins over the previous one.
  for (const delta of [0, 1, -1]) {
    try {
      const expected = String(await totp.generate({ secret, epoch: (base + delta) * 30 }))
      if (expected === clean) return { ok: true, step: base + delta }
    } catch {
      return { ok: false }
    }
  }
  return { ok: false }
}
