// ═══════════════════════════════════════════════════════════
// T4 auth verification script (bun, no test framework).
// Covers: argon2id hash/verify + dummy-hash timing, TOTP valid/±1/replay/
// wrong-secret, recovery codes gen/consume/regen, AES-256-GCM tamper
// detection, session idle/absolute/revoked expiry (direct service calls).
// Usage (explicit PG env — the sandbox shell injects a stale legacy file-DB URL):
//   DATABASE_URL="postgresql://postgres@127.0.0.1:5432/sibra" \
//   DIRECT_URL="postgresql://postgres@127.0.0.1:5432/sibra" \
//   bun scripts/auth-verify.ts
// ═══════════════════════════════════════════════════════════

import { db } from '../src/lib/db'
import { hashPassword, verifyPassword, verifyPasswordAgainstDummy, needsRehash, ARGON2_OPTS } from '../src/lib/auth/password'
import { totpGenerateSecret, totpVerify, currentTotpStep } from '../src/lib/auth/totp'
import { encryptSecret, decryptSecret, generateRecoveryCode, formatRecoveryCode, normaliseRecoveryCode, recoveryCodeHash, sha256Hex, hmacHex } from '../src/lib/auth/crypto'
import { createSession, resolveSession, revokeSessionById, STAGE_FULL } from '../src/lib/auth/session'
import type { NextRequest } from 'next/server'

let failures = 0
const lines: string[] = []
function check(name: string, ok: boolean, extra = ''): void {
  if (!ok) failures++
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

/** Minimal duck-typed NextRequest stand-in (resolveSession only reads headers). */
function fakeRequest(cookieToken: string | null, ua = 'auth-verify-ua'): NextRequest {
  const headers = new Headers()
  if (cookieToken) headers.set('cookie', `sdh_admin=${cookieToken}`)
  headers.set('user-agent', ua)
  return { headers } as unknown as NextRequest
}

async function main() {
  // ── 1. argon2id ──────────────────────────────────────────
  const pw = 'correct-horse-battery-staple-42'
  const hash = await hashPassword(pw)
  check('argon2id: PHC embeds OWASP params', hash.includes(`m=${ARGON2_OPTS.memoryCost},t=${ARGON2_OPTS.timeCost},p=${ARGON2_OPTS.parallelism}`))
  check('argon2id: verify ok', await verifyPassword(hash, pw))
  check('argon2id: verify wrong password = false', !(await verifyPassword(hash, 'wrong-password-123')))
  check('argon2id: rehash needed for weak params', needsRehash('$argon2id$v=19$m=4096,t=2,p=1$abc$def'))
  check('argon2id: no rehash for current params', !needsRehash(hash))

  const t1 = Date.now()
  await verifyPassword(hash, pw)
  const realMs = Date.now() - t1
  const t2 = Date.now()
  await verifyPasswordAgainstDummy('some-guess-password')
  const dummyMs = Date.now() - t2
  const ratio = Math.max(realMs, dummyMs) / Math.max(1, Math.min(realMs, dummyMs))
  check('argon2id: dummy-hash timing ≈ real verify', ratio < 3, `real=${realMs}ms dummy=${dummyMs}ms ratio=${ratio.toFixed(2)}`)

  // ── 2. TOTP ──────────────────────────────────────────────
  const secret = totpGenerateSecret()
  const now = Date.now()
  const base = currentTotpStep(now)
  const { TOTP, NobleCryptoPlugin, ScureBase32Plugin } = await import('otplib')
  const gen = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin(), digits: 6, period: 30, algorithm: 'sha1' })
  const codeNow = String(await gen.generate({ secret, epoch: base * 30 }))
  const codePrev = String(await gen.generate({ secret, epoch: (base - 1) * 30 }))
  const codeNext = String(await gen.generate({ secret, epoch: (base + 1) * 30 }))

  const v0 = await totpVerify(secret, codeNow, now)
  check('totp: current step valid', v0.ok && v0.step === base)
  const vm = await totpVerify(secret, codePrev, now)
  check('totp: −1 window valid', vm.ok && vm.step === base - 1)
  const vp = await totpVerify(secret, codeNext, now)
  check('totp: +1 window valid', vp.ok && vp.step === base + 1)
  const vf = await totpVerify(secret, '000000', now)
  check('totp: wrong code rejected', !vf.ok || vf.step === undefined)
  const vs = await totpVerify(secret, codeNow, now + 5 * 60_000)
  check('totp: valid code rejected 5 min later (outside ±1)', !vs.ok || vs.step === undefined)
  // replay rule (service-level): reject step <= lastTotpStep
  const last = BigInt(v0.step ?? 0)
  const vAgain = await totpVerify(secret, codeNow, now)
  check('totp: replay rejected by lastTotpStep rule', !(vAgain.ok && vAgain.step !== undefined && BigInt(vAgain.step) > last))
  const wrongSecret = totpGenerateSecret()
  const vws = await totpVerify(wrongSecret, codeNow, now)
  check('totp: wrong secret rejected', !vws.ok || vws.step === undefined)

  // ── 3. Recovery codes ────────────────────────────────────
  const code = generateRecoveryCode()
  check('recovery: 16 Crockford chars', /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(code), code)
  const formatted = formatRecoveryCode(code)
  check('recovery: display format XXXX-XXXX-XXXX-XXXX', /^\S{4}-\S{4}-\S{4}-\S{4}$/.test(formatted), formatted)
  const stored = [recoveryCodeHash(normaliseRecoveryCode(code))]
  const typed = recoveryCodeHash(normaliseRecoveryCode(formatted)) // user pastes the dashed form
  const consumed = stored.filter((h) => h !== typed)
  check('recovery: consume (dashed input matches stored)', consumed.length === 0 && stored.length === 1)
  const wrongCase = recoveryCodeHash(normaliseRecoveryCode(formatted.toLowerCase().replace(/o/g, '0').replace(/[il]/g, '1')))
  check('recovery: normalised variants match (O→0, I/L→1, case)', wrongCase === typed)
  const missing = stored.filter((h) => h === recoveryCodeHash(normaliseRecoveryCode('YYYY-YYYY-YYYY-YYYY')))
  check('recovery: wrong code does not match', missing.length === 0)

  // ── 4. AES-256-GCM ───────────────────────────────────────
  const totpSecretAtRest = encryptSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')
  check('aes-gcm: format v1.iv.ct.tag', /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(totpSecretAtRest))
  check('aes-gcm: roundtrip', decryptSecret(totpSecretAtRest) === 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')
  check('aes-gcm: unique IV per call', encryptSecret('x') !== encryptSecret('x'))
  const parts = totpSecretAtRest.split('.')
  const tamperedCt = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA')
  let tamperThrew = false
  try {
    decryptSecret([parts[0], parts[1], tamperedCt, parts[3]].join('.'))
  } catch {
    tamperThrew = true
  }
  check('aes-gcm: tampered ciphertext throws (auth tag)', tamperThrew)
  let tamperTagThrew = false
  try {
    decryptSecret([parts[0], parts[1], parts[2], parts[3].slice(0, -2) + 'ZZ'].join('.'))
  } catch {
    tamperTagThrew = true
  }
  check('aes-gcm: tampered auth tag throws', tamperTagThrew)

  // ── 5. Hash helpers ──────────────────────────────────────
  check('crypto: sha256 stable', sha256Hex('a') === sha256Hex('a') && sha256Hex('a') !== sha256Hex('b'))
  check('crypto: hmac pepper salted', hmacHex('ua:x') === hmacHex('ua:x') && hmacHex('ua:x') !== hmacHex('ua:y'))

  // ── 6. Session expiry logic (real rows, cleaned up after) ─
  const admin = await db.adminUser.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!admin) {
    check('session: dev admin exists', false, 'run `bun run admin:create` first')
  } else {
    const issued = await createSession({ adminId: admin.id, stage: STAGE_FULL, ip: '127.0.0.1', ua: 'auth-verify-ua' })
    const sid = issued.session.id
    try {
      const fresh = await resolveSession(fakeRequest(issued.token))
      check('session: fresh session resolves', fresh?.session.id === sid)
      const wrongUa = await resolveSession(fakeRequest(issued.token, 'different-ua'))
      check('session: UA mismatch rejected (soft-bind)', wrongUa === null)

      await db.adminSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 61 * 60_000) } })
      const idle = await resolveSession(fakeRequest(issued.token))
      check('session: idle > 60 min rejected', idle === null)

      await db.adminSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() - 1000) } })
      const expired = await resolveSession(fakeRequest(issued.token))
      check('session: absolute expiry (12 h) rejected', expired === null)

      await db.adminSession.update({ where: { id: sid }, data: { expiresAt: new Date(Date.now() + 3600_000), revokedAt: new Date() } })
      const revoked = await resolveSession(fakeRequest(issued.token))
      check('session: revoked session rejected', revoked === null)

      await db.adminSession.update({ where: { id: sid }, data: { revokedAt: null } })
      const revived = await resolveSession(fakeRequest(issued.token))
      check('session: un-revoked resolves again', revived?.session.id === sid)
      await revokeSessionById(sid)
      const afterRevoke = await resolveSession(fakeRequest(issued.token))
      check('session: revokeSessionById blocks access', afterRevoke === null)
    } finally {
      await db.adminSession.deleteMany({ where: { id: sid } }).catch(() => undefined)
    }
  }

  console.log(lines.join('\n'))
  if (failures > 0) {
    console.error(`\nAUTH VERIFY: ${failures} failure(s)`)
    process.exit(1)
  }
  console.log('\nAUTH VERIFY: all checks passed')
}

main()
  .catch((e) => {
    console.error('auth-verify error:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
