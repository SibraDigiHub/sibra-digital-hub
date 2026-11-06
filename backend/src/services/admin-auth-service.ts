// ═══════════════════════════════════════════════════════════
// T4 admin auth service — login + lockout, TOTP/passkey/recovery
// second factors, password change/reset, sessions management.
// Rules live here; routes stay thin. Never reveal whether an
// email exists; never log secrets, tokens or full emails.
// ═══════════════════════════════════════════════════════════

import type { AdminSession, AdminUser } from '@prisma/client'
import QRCode from 'qrcode'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { ApiError, badRequest, conflict, notFound } from '@/lib/api'
import { db } from '@/lib/db'
import { env, adminRequire2fa, adminPasskeysEnabled } from '@/config/env'
import { writeAudit, maskEmail } from '@/lib/audit'
import { queueSecurityAlert, ALERTS } from '@/lib/auth/alerts'
import {
  decryptSecret,
  encryptSecret,
  formatRecoveryCode,
  generateRecoveryCode,
  hashIp,
  hashUa,
  normaliseRecoveryCode,
  randomToken,
  recoveryCodeHash,
  sha256Hex,
} from '@/lib/auth/crypto'
import {
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from '@/lib/auth/password'
import {
  createSession,
  rotateSession,
  revokeAllSessionsForAdmin,
  STAGE_ENROLL,
  STAGE_FULL,
  STAGE_PENDING_2FA,
} from '@/lib/auth/session'
import { totpGenerateSecret, totpKeyUri, totpVerify } from '@/lib/auth/totp'
import {
  consumeRateLimit,
  enrollLimitPerSession,
  forgotLimitPerEmail,
  forgotLimitPerIp,
  loginLimitPerIp,
  loginLimitPerIpEmail,
  resetLimitPerIpToken,
  twoFaLimitPerSession,
} from '@/lib/auth/rate-limit'

const GENERIC_LOGIN_ERROR = 'Invalid email or password'
const GENERIC_CODE_ERROR = 'Invalid code'
const RECOVERY_CODE_COUNT = 10
const LOCKOUT_BASE_MIN = 15
const LOCKOUT_MAX_MIN = 24 * 60
const LOCKOUT_EVERY = 5 // consecutive failures per lock tier

// ── Shared helpers ──────────────────────────────────────────

export async function factorCount(admin: AdminUser): Promise<number> {
  const passkeys = await db.adminPasskey.count({ where: { adminId: admin.id } })
  return (admin.totpEnabled ? 1 : 0) + passkeys + admin.recoveryCodeHashes.length
}

async function assertNotLastFactor(adminId: string, remove: 'totp' | 'passkey' | 'recovery'): Promise<void> {
  const admin = await db.adminUser.findUniqueOrThrow({ where: { id: adminId } })
  const passkeys = await db.adminPasskey.count({ where: { adminId } })
  const total =
    (admin.totpEnabled ? 1 : 0) +
    passkeys +
    admin.recoveryCodeHashes.length -
    (remove === 'totp' && admin.totpEnabled ? 1 : 0) -
    (remove === 'recovery' ? admin.recoveryCodeHashes.length : 0)
  if (total < 1) {
    throw conflict('At least one second factor must remain enabled')
  }
}

/** New-device detection: compare the UA hash against previous auth.login audit rows. */
async function isNewDevice(adminId: string, ua: string): Promise<boolean> {
  const last = await db.auditLog.findFirst({
    where: { action: 'auth.login', entity: 'admin', entityId: adminId },
    orderBy: { createdAt: 'desc' },
  })
  if (!last?.diff) return false
  try {
    const diff = JSON.parse(last.diff) as { uaHash?: string }
    return Boolean(diff.uaHash && diff.uaHash !== hashUa(ua).slice(0, 12))
  } catch {
    return false
  }
}

function uaFingerprint(ua: string): string {
  return hashUa(ua).slice(0, 12)
}

async function maybeAlertFailedLogins(admin: AdminUser, email: string): Promise<void> {
  const count = await db.auditLog.count({
    where: { action: 'auth.login_failed', entityId: admin.id, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
  })
  if (count >= 10) {
    // Fire once per 15-min window (marker row keeps it from repeating).
    const recent = await db.auditLog.findFirst({
      where: { action: 'auth.alert_failed_10', entityId: admin.id, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
    })
    if (!recent) {
      await writeAudit({ action: 'auth.alert_failed_10', entity: 'admin', entityId: admin.id, label: maskEmail(email), ip: 'internal' })
      queueSecurityAlert(ALERTS.failedLogins(email, count))
    }
  }
}

// ── 1. Login ────────────────────────────────────────────────

export interface LoginResult {
  stage: typeof STAGE_FULL | typeof STAGE_PENDING_2FA | typeof STAGE_ENROLL
  token: string
  admin: AdminUser
  csrfToken?: string
}

export async function loginWithEmail(input: { email: string; password: string; ip: string; ua: string }): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase()

  // Postgres-backed limits: 5 / 15 min per IP+email, 20 / hour per IP.
  const perIpEmail = await loginLimitPerIpEmail(input.ip, email)
  if (!perIpEmail.allowed) throw new ApiError(429, `Too many attempts — try again in ${Math.ceil(perIpEmail.retryAfterSec / 60)} min`, 'rate_limited')
  const perIp = await loginLimitPerIp(input.ip)
  if (!perIp.allowed) throw new ApiError(429, `Too many attempts — try again in ${Math.ceil(perIp.retryAfterSec / 60)} min`, 'rate_limited')

  const admin = await db.adminUser.findUnique({ where: { email } })
  if (!admin) {
    // Constant-time dummy verification — never reveal that the email is unknown.
    await verifyPasswordAgainstDummy(input.password)
    await writeAudit({ action: 'auth.login_failed', entity: 'admin', label: maskEmail(email), diff: { reason: 'unknown_email' }, ip: input.ip })
    throw new ApiError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials')
  }

  // Account lockout — same generic error, never "locked".
  if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
    await verifyPasswordAgainstDummy(input.password)
    await writeAudit({ action: 'auth.login_failed', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { reason: 'locked' }, ip: input.ip })
    throw new ApiError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials')
  }

  const passwordOk = await verifyPassword(admin.passwordHash, input.password)
  if (!passwordOk) {
    const failedLogins = admin.failedLogins + 1
    const data: { failedLogins: number; lockedUntil?: Date } = { failedLogins }
    if (failedLogins % LOCKOUT_EVERY === 0) {
      const tier = failedLogins / LOCKOUT_EVERY // 1st lock 15 min, then doubling
      const minutes = Math.min(LOCKOUT_BASE_MIN * 2 ** (tier - 1), LOCKOUT_MAX_MIN)
      data.lockedUntil = new Date(Date.now() + minutes * 60_000)
      await writeAudit({ action: 'auth.lockout', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { minutes, failedLogins }, ip: input.ip })
      queueSecurityAlert(ALERTS.locked(email, minutes))
    }
    await db.adminUser.update({ where: { id: admin.id }, data })
    await writeAudit({ action: 'auth.login_failed', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { reason: 'bad_password', failedLogins }, ip: input.ip })
    await maybeAlertFailedLogins(admin, email)
    throw new ApiError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials')
  }

  // Auto-rehash when embedded params are weaker than the current OWASP target.
  if (needsRehash(admin.passwordHash)) {
    const rehashed = await hashPassword(input.password)
    await db.adminUser.update({ where: { id: admin.id }, data: { passwordHash: rehashed } }).catch(() => undefined)
  }

  const hasFactors = await factorCount(admin)

  // Restricted enrollment session: production first login, 2FA required, no factors yet.
  if (hasFactors === 0 && adminRequire2fa()) {
    const issued = await createSession({ adminId: admin.id, stage: STAGE_ENROLL, ip: input.ip, ua: input.ua })
    await writeAudit({ action: 'auth.enroll_stage', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { reason: 'no_second_factor' }, ip: input.ip })
    return { stage: STAGE_ENROLL, token: issued.token, csrfToken: issued.csrfToken, admin }
  }

  // Any second factor → short-lived PENDING_2FA session (5 min).
  if (hasFactors > 0) {
    const issued = await createSession({
      adminId: admin.id,
      stage: STAGE_PENDING_2FA,
      ip: input.ip,
      ua: input.ua,
      lifetimeMs: 5 * 60_000,
    })
    return { stage: STAGE_PENDING_2FA, token: issued.token, admin }
  }

  // Dev path (require2FA off, no factors): full session immediately.
  return completeLogin({ admin, ip: input.ip, ua: input.ua, method: 'password' })
}

/** Issue a FULL session (fresh token), stamp lastLoginAt, audit + new-device alert. */
export async function completeLogin(input: { admin: AdminUser; ip: string; ua: string; method: string; pendingSessionId?: string }): Promise<LoginResult> {
  const { admin, ip, ua, method } = input
  const issued = input.pendingSessionId
    ? await rotateSession(input.pendingSessionId, admin.id, ip, ua)
    : await createSession({ adminId: admin.id, stage: STAGE_FULL, ip, ua })
  await db.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
  })
  await writeAudit({
    action: 'auth.login',
    entity: 'admin',
    entityId: admin.id,
    label: maskEmail(admin.email),
    diff: { method, uaHash: uaFingerprint(ua) },
    ip,
  })
  if (await isNewDevice(admin.id, ua)) {
    queueSecurityAlert(ALERTS.newDevice(admin.email, uaFingerprint(ua)))
  }
  return { stage: STAGE_FULL, token: issued.token, csrfToken: issued.csrfToken, admin }
}

// ── 2. Second factor at login (TOTP | recovery code) ───────

export async function verifyLogin2fa(input: {
  session: AdminSession
  admin: AdminUser
  code?: string
  recoveryCode?: string
  ip: string
  ua: string
}): Promise<LoginResult> {
  const { session, admin } = input
  if (session.stage !== STAGE_PENDING_2FA) throw notFound('Not found')
  const limit = await twoFaLimitPerSession(session.id)
  if (!limit.allowed) throw new ApiError(429, `Too many attempts — try again in ${Math.ceil(limit.retryAfterSec / 60)} min`, 'rate_limited')

  let method: string | null = null

  if (input.recoveryCode) {
    const normalised = normaliseRecoveryCode(input.recoveryCode)
    const hash = recoveryCodeHash(normalised)
    if (admin.recoveryCodeHashes.includes(hash)) {
      await db.adminUser.update({
        where: { id: admin.id },
        data: { recoveryCodeHashes: admin.recoveryCodeHashes.filter((h) => h !== hash) },
      })
      method = 'recovery_code'
    }
  } else if (input.code) {
    if (admin.totpEnabled && admin.totpSecretEnc) {
      try {
        const secret = decryptSecret(admin.totpSecretEnc)
        const check = await totpVerify(secret, input.code)
        const last = admin.lastTotpStep ?? BigInt(-1)
        if (check.ok && check.step !== undefined && BigInt(check.step) > last) {
          await db.adminUser.update({ where: { id: admin.id }, data: { lastTotpStep: BigInt(check.step) } })
          method = 'totp'
        }
      } catch {
        /* fall through to generic error */
      }
    }
  }

  if (!method) {
    await writeAudit({ action: 'auth.2fa_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { sessionId: session.id }, ip: input.ip })
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }

  const remaining = method === 'recovery_code' ? admin.recoveryCodeHashes.length - 1 : admin.recoveryCodeHashes.length
  await writeAudit({ action: 'auth.2fa_success', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { method, recoveryCodesRemaining: remaining }, ip: input.ip })
  return completeLogin({ admin, ip: input.ip, ua: input.ua, method, pendingSessionId: session.id })
}

// ── 3. TOTP enrollment ──────────────────────────────────────

export async function startTotpEnrollment(session: AdminSession, admin: AdminUser, ip: string) {
  if (admin.totpEnabled) throw conflict('Authenticator app is already enabled')
  const limit = await enrollLimitPerSession(session.id)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again later', 'rate_limited')

  const secret = totpGenerateSecret()
  await db.adminUser.update({ where: { id: admin.id }, data: { totpSecretEnc: encryptSecret(secret), totpEnabled: false, lastTotpStep: null } })
  const otpauthUrl = totpKeyUri(admin.email, secret)
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 })
  return { secret, otpauthUrl, qrDataUrl }
}

export async function confirmTotpEnrollment(session: AdminSession, admin: AdminUser, code: string, ip: string) {
  if (admin.totpEnabled) throw conflict('Authenticator app is already enabled')
  if (!admin.totpSecretEnc) throw badRequest('Start enrollment first')
  const limit = await enrollLimitPerSession(session.id)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again later', 'rate_limited')

  let step: number | undefined
  try {
    const secret = decryptSecret(admin.totpSecretEnc)
    const check = await totpVerify(secret, code)
    if (!check.ok) step = undefined
    else step = check.step
  } catch {
    throw badRequest('Start enrollment first')
  }
  if (step === undefined) {
    await writeAudit({ action: 'auth.2fa_confirm_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), ip })
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }

  // First factor confirmed → recovery codes are generated once, shown now.
  let recoveryCodes: string[] | undefined
  const data: { totpEnabled: boolean; lastTotpStep: bigint; recoveryCodeHashes?: string[] } = {
    totpEnabled: true,
    lastTotpStep: BigInt(step),
  }
  if (admin.recoveryCodeHashes.length === 0) {
    const { codes, hashes } = generateRecoveryCodes()
    data.recoveryCodeHashes = hashes
    recoveryCodes = codes
  }
  await db.adminUser.update({ where: { id: admin.id }, data })
  await writeAudit({ action: 'auth.2fa_enabled', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { method: 'totp' }, ip })
  queueSecurityAlert(ALERTS.totpAdded(admin.email))
  return { ok: true, recoveryCodes }
}

export async function disableTotp(session: AdminSession, admin: AdminUser, password: string, ip: string) {
  if (!admin.totpEnabled) throw conflict('Authenticator app is not enabled')
  // Step-up: inline password re-entry. Authenticated context (full session +
  // CSRF), so the error may name the problem precisely — unlike the public
  // login route, there is no enumeration concern here.
  if (!(await verifyPassword(admin.passwordHash, password))) {
    await writeAudit({ action: 'auth.stepup_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { for: '2fa_disable' }, ip })
    // 403 (not 401): the session itself is valid — only the step-up password
    // is wrong. A 401 would trip the frontend's global "session expired"
    // handler and sign the admin out mid-action.
    throw new ApiError(403, 'Incorrect password — enter the password you sign in with', 'invalid_credentials')
  }
  await assertNotLastFactor(admin.id, 'totp')
  // Recovery codes were issued as one-time backups for this authenticator —
  // they are void once TOTP is removed. Clearing them also drops factorCount
  // to 0 so the next login is not trapped on the PENDING_2FA code step: with
  // require2FA (production default) the login re-enters ENROLL, without it
  // the admin signs in directly. Passkey logins are unaffected.
  await db.adminUser.update({
    where: { id: admin.id },
    data: { totpEnabled: false, totpSecretEnc: null, lastTotpStep: null, recoveryCodeHashes: [] },
  })
  await writeAudit({ action: 'auth.2fa_disabled', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { method: 'totp', recoveryCodesCleared: admin.recoveryCodeHashes.length }, ip })
  queueSecurityAlert(ALERTS.totpRemoved(admin.email))
  return { ok: true }
}

// ── 4. Recovery codes ───────────────────────────────────────

function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = []
  const hashes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = generateRecoveryCode()
    codes.push(formatRecoveryCode(raw))
    hashes.push(recoveryCodeHash(normaliseRecoveryCode(raw)))
  }
  return { codes, hashes }
}

export async function regenerateRecoveryCodes(session: AdminSession, admin: AdminUser, password: string | undefined, ip: string) {
  // Step-up (inline password) is required from a FULL session; the restricted
  // ENROLL stage already proved the password moments ago.
  if (session.stage !== STAGE_ENROLL) {
    if (!password || !(await verifyPassword(admin.passwordHash, password))) {
      await writeAudit({ action: 'auth.stepup_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { for: 'recovery_regen' }, ip })
      throw new ApiError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials')
    }
  }
  const limit = await enrollLimitPerSession(session.id)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again later', 'rate_limited')
  const { codes, hashes } = generateRecoveryCodes()
  await db.adminUser.update({ where: { id: admin.id }, data: { recoveryCodeHashes: hashes } })
  await writeAudit({ action: 'auth.recovery_regenerated', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { count: codes.length }, ip })
  queueSecurityAlert(ALERTS.recoveryRegenerated(admin.email))
  return { codes, remaining: codes.length }
}

// ── 5. Passkeys (WebAuthn) ──────────────────────────────────

// Non-production (sandbox/preview) convenience: the browsing origin of a hosted
// preview is not knowable ahead of time (same rationale as the CSRF preview
// allowance in lib/auth/session.ts), so the RP config is derived from the
// browser's own Origin header. The derived pair is self-consistent
// (rpID = that origin's host, as WebAuthn requires); https/localhost only.
function devRpFromBrowserOrigin(browserOrigin: string | null): { rpID: string; origin: string } | null {
  if (process.env.NODE_ENV === 'production') return null
  if (!browserOrigin) return null
  try {
    const url = new URL(browserOrigin)
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !isLocal) return null
    return { rpID: url.hostname, origin: url.origin }
  } catch {
    return null
  }
}

function rpConfig(browserOrigin: string | null): { rpID: string; rpName: string; origin: string } {
  const rpName = process.env.ADMIN_WEBAUTHN_RP_NAME || 'Sibra Digital Hub'
  const rpID = process.env.ADMIN_WEBAUTHN_RP_ID
  const origin = process.env.ADMIN_WEBAUTHN_ORIGIN
  // Pinned pair wins (production requirement); production keeps the strict
  // 503 below whenever either half is missing.
  if (rpID && origin) return { rpID, rpName, origin }
  const dev = devRpFromBrowserOrigin(browserOrigin)
  if (dev) return { rpID: dev.rpID, rpName, origin: dev.origin }
  throw new ApiError(503, 'Passkeys are not configured on this server', 'passkeys_unconfigured')
}

function assertPasskeysEnabled(): void {
  if (!adminPasskeysEnabled()) throw new ApiError(403, 'Passkeys are disabled', 'passkeys_disabled')
}

async function consumeChallenge(challenge: string, purpose: 'REGISTER' | 'LOGIN', adminId?: string) {
  const row = await db.adminWebauthnChallenge.findUnique({ where: { challenge } })
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.purpose !== purpose) {
    throw new ApiError(400, 'Invalid or expired challenge', 'bad_challenge')
  }
  if (adminId && row.adminId && row.adminId !== adminId) throw new ApiError(400, 'Invalid or expired challenge', 'bad_challenge')
  await db.adminWebauthnChallenge.update({ where: { id: row.id }, data: { usedAt: new Date() } })
  return row
}

export async function passkeyRegisterOptions(session: AdminSession, admin: AdminUser, browserOrigin: string | null, ip: string) {
  assertPasskeysEnabled()
  const { rpID, rpName } = rpConfig(browserOrigin)
  const limit = await enrollLimitPerSession(session.id)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again later', 'rate_limited')

  const existing = await db.adminPasskey.findMany({ where: { adminId: admin.id }, select: { credentialId: true, transports: true } })
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(admin.id),
    userName: admin.email,
    userDisplayName: admin.name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  })
  await db.adminWebauthnChallenge.create({
    data: { adminId: admin.id, challenge: options.challenge, purpose: 'REGISTER', expiresAt: new Date(Date.now() + 5 * 60_000) },
  })
  void ip
  return { options }
}

export async function passkeyRegisterVerify(session: AdminSession, admin: AdminUser, browserOrigin: string | null, response: unknown, name: string | undefined, ip: string) {
  assertPasskeysEnabled()
  const { rpID, origin } = rpConfig(browserOrigin)
  const limit = await enrollLimitPerSession(session.id)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again later', 'rate_limited')

  const challenge = extractChallenge(response)
  if (!challenge) throw badRequest('Invalid or expired challenge')
  await consumeChallenge(challenge, 'REGISTER', admin.id)

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
  } catch {
    throw new ApiError(401, 'Passkey registration failed', 'passkey_failed')
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new ApiError(401, 'Passkey registration failed', 'passkey_failed')
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  await db.adminPasskey.create({
    data: {
      adminId: admin.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(Math.max(0, credential.counter)),
      transports: (credential.transports ?? []) as string[],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: (name || 'Passkey').slice(0, 60),
      lastUsedAt: new Date(),
    },
  })

  let recoveryCodes: string[] | undefined
  const fresh = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } })
  if (fresh.recoveryCodeHashes.length === 0) {
    const { codes, hashes } = generateRecoveryCodes()
    await db.adminUser.update({ where: { id: admin.id }, data: { recoveryCodeHashes: hashes } })
    recoveryCodes = codes
  }

  await writeAudit({ action: 'auth.passkey_added', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { name: (name || 'Passkey').slice(0, 60) }, ip })
  queueSecurityAlert(ALERTS.passkeyAdded(admin.email, (name || 'Passkey').slice(0, 60)))
  return { ok: true, recoveryCodes }
}

export async function passkeyLoginOptions(email: string, browserOrigin: string | null, ip: string) {
  assertPasskeysEnabled()
  const { rpID } = rpConfig(browserOrigin)
  const limit = await loginLimitPerIpEmail(ip, email)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again in ' + Math.ceil(limit.retryAfterSec / 60) + ' min', 'rate_limited')

  const admin = await db.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } })
  const passkeys = admin ? await db.adminPasskey.findMany({ where: { adminId: admin.id }, select: { credentialId: true, transports: true } }) : []
  // Unknown emails get identical-looking options (no enumeration) — but the
  // challenge row has no adminId, so verification later fails generically.
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
  })
  await db.adminWebauthnChallenge.create({
    data: { adminId: admin?.id ?? null, challenge: options.challenge, purpose: 'LOGIN', expiresAt: new Date(Date.now() + 5 * 60_000) },
  })
  return { options }
}

export async function passkeyLoginVerify(input: { email: string; response: unknown; session: AdminSession | null; browserOrigin: string | null; ip: string; ua: string }): Promise<LoginResult> {
  assertPasskeysEnabled()
  const { rpID, origin } = rpConfig(input.browserOrigin)
  const email = input.email.trim().toLowerCase()
  const limit = await loginLimitPerIpEmail(input.ip, email)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again in ' + Math.ceil(limit.retryAfterSec / 60) + ' min', 'rate_limited')

  // A passkey completes a PENDING_2FA login: the pending session must exist
  // and belong to the same admin the assertion claims.
  const admin = await db.adminUser.findUnique({ where: { email } })
  if (!admin || !input.session || input.session.stage !== STAGE_PENDING_2FA || input.session.adminId !== admin.id) {
    await verifyPasswordAgainstDummy('x'.repeat(16))
    await writeAudit({ action: 'auth.2fa_failed', entity: 'admin', label: maskEmail(email), diff: { method: 'passkey' }, ip: input.ip })
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }

  const challenge = extractChallenge(input.response)
  if (!challenge) throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  await consumeChallenge(challenge, 'LOGIN', admin.id)

  const assertionId = extractCredentialId(input.response)
  const passkey = assertionId
    ? await db.adminPasskey.findUnique({ where: { credentialId: assertionId } })
    : null
  if (!passkey || passkey.adminId !== admin.id) {
    await writeAudit({ action: 'auth.2fa_failed', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { method: 'passkey' }, ip: input.ip })
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as never,
      },
    })
  } catch {
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }
  if (!verification.verified) {
    await writeAudit({ action: 'auth.2fa_failed', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { method: 'passkey' }, ip: input.ip })
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }

  // Counter must be monotonic — a regression means a cloned authenticator.
  const newCounter = BigInt(verification.authenticationInfo.newCounter)
  if (newCounter !== 0n && newCounter <= passkey.counter) {
    await revokeAllSessionsForAdmin(admin.id)
    await writeAudit({ action: 'auth.passkey_counter_regression', entity: 'admin', entityId: admin.id, label: maskEmail(email), ip: input.ip })
    throw new ApiError(401, GENERIC_CODE_ERROR, 'invalid_code')
  }
  await db.adminPasskey.update({ where: { id: passkey.id }, data: { counter: newCounter, lastUsedAt: new Date() } })

  await writeAudit({ action: 'auth.2fa_success', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { method: 'passkey' }, ip: input.ip })
  return completeLogin({ admin, ip: input.ip, ua: input.ua, method: 'passkey', pendingSessionId: input.session.id })
}

function extractChallenge(response: unknown): string | null {
  // The challenge travels inside clientDataJSON (base64url JSON) — there is no
  // `response.challenge` field on a WebAuthn response. A top-level `challenge`
  // string is still accepted as a legacy convenience; it must still match a
  // stored single-use challenge row to be usable.
  const r = response as { response?: { clientDataJSON?: unknown }; challenge?: unknown } | null
  const raw = r?.response?.clientDataJSON ?? r?.challenge
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const clientData = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { challenge?: unknown }
    return typeof clientData.challenge === 'string' ? clientData.challenge : null
  } catch {
    return null
  }
}

function extractCredentialId(response: unknown): string | null {
  const r = response as { id?: unknown } | null
  return typeof r?.id === 'string' ? r.id : null
}

export async function listPasskeys(adminId: string) {
  const rows = await db.adminPasskey.findMany({ where: { adminId }, orderBy: { createdAt: 'asc' } })
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    deviceType: p.deviceType,
    backedUp: p.backedUp,
    transports: p.transports,
    createdAt: p.createdAt.toISOString(),
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
  }))
}

export async function deletePasskey(session: AdminSession, admin: AdminUser, passkeyId: string, password: string, ip: string) {
  if (!password || !(await verifyPassword(admin.passwordHash, password))) {
    await writeAudit({ action: 'auth.stepup_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { for: 'passkey_delete' }, ip })
    throw new ApiError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials')
  }
  const passkey = await db.adminPasskey.findUnique({ where: { id: passkeyId } })
  if (!passkey || passkey.adminId !== admin.id) throw notFound('Passkey not found')
  await assertNotLastFactor(admin.id, 'passkey')
  await db.adminPasskey.delete({ where: { id: passkey.id } })
  await writeAudit({ action: 'auth.passkey_removed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { name: passkey.name }, ip })
  queueSecurityAlert(ALERTS.passkeyRemoved(admin.email, passkey.name))
  return { ok: true }
}

// ── 6. Password change (step-up) ────────────────────────────

export async function changePassword(session: AdminSession, admin: AdminUser, currentPassword: string, newPassword: string, ip: string) {
  // Step-up re-authentication: the current password IS the proof.
  if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
    await writeAudit({ action: 'auth.stepup_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { for: 'password_change' }, ip })
    throw new ApiError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials')
  }
  const policy = checkPasswordPolicy(newPassword, admin.email)
  if (!policy.ok) throw badRequest(policy.reason ?? 'Password does not meet the policy')

  const passwordHash = await hashPassword(newPassword)
  await db.adminUser.update({ where: { id: admin.id }, data: { passwordHash, passwordChangedAt: new Date() } })
  // Revoke every OTHER session (the current one stays alive for continuity).
  const revoked = await revokeAllSessionsForAdmin(admin.id, session.id)
  await writeAudit({ action: 'auth.password_changed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { otherSessionsRevoked: revoked }, ip })
  queueSecurityAlert(ALERTS.passwordChanged(admin.email))
  return { ok: true, otherSessionsRevoked: revoked }
}

// ── 7. Forgot / reset password ──────────────────────────────

export interface ForgotResult {
  /** always the same public message */
  message: string
  /** populated only for real admins — the route emails it after the response */
  resetLink?: string
  adminEmail?: string
}

export async function requestPasswordReset(input: { email: string; ip: string }): Promise<ForgotResult> {
  const email = input.email.trim().toLowerCase()
  const message = 'If this email is registered, a reset link has been sent.'
  const perIp = await forgotLimitPerIp(input.ip)
  if (!perIp.allowed) return { message } // silent throttle — same public answer
  const perEmail = await forgotLimitPerEmail(email)
  if (!perEmail.allowed) return { message }

  const admin = await db.adminUser.findUnique({ where: { email } })

  // Equal work for unknown emails: fake token + hashing, no observable difference.
  const fakeToken = randomToken()
  sha256Hex(fakeToken)
  if (!admin) {
    await verifyPasswordAgainstDummy(fakeToken)
    await writeAudit({ action: 'auth.reset_requested', entity: 'admin', label: maskEmail(email), diff: { known: false }, ip: input.ip })
    return { message }
  }

  // One active token per admin — new request invalidates older ones.
  await db.adminPasswordReset.deleteMany({ where: { adminId: admin.id } })
  const token = randomToken()
  await db.adminPasswordReset.create({
    data: {
      adminId: admin.id,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + env.ADMIN_RESET_TTL_MINUTES * 60_000),
      requestIpHash: input.ip === 'unknown' ? null : hashIp(input.ip),
    },
  })
  const base = env.PUBLIC_WEB_URL || 'http://localhost:3000'
  // Token lives ONLY in the URL fragment (never a server log, never a referrer).
  const resetLink = `${base.replace(/\/+$/, '')}/#/admin-reset?token=${token}`
  await writeAudit({ action: 'auth.reset_requested', entity: 'admin', entityId: admin.id, label: maskEmail(email), diff: { known: true }, ip: input.ip })
  return { message, resetLink, adminEmail: admin.email }
}

export interface ResetSecondFactor {
  totp?: string
  recoveryCode?: string
}

export async function resetPassword(input: {
  token: string
  password: string
  secondFactor: ResetSecondFactor
  ip: string
}): Promise<{ ok: true }> {
  const { token, ip } = input
  const limit = await resetLimitPerIpToken(ip, token)
  if (!limit.allowed) throw new ApiError(429, 'Too many attempts — try again later', 'rate_limited')

  const row = await db.adminPasswordReset.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { admin: true } })
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    throw badRequest('Invalid or expired reset link')
  }
  const admin = row.admin

  // Second factor is mandatory — a stolen mailbox alone can never take over.
  let factorOk = false
  if (input.secondFactor.totp && admin.totpEnabled && admin.totpSecretEnc) {
    try {
      const secret = decryptSecret(admin.totpSecretEnc)
      const check = await totpVerify(secret, input.secondFactor.totp)
      const last = admin.lastTotpStep ?? BigInt(-1)
      if (check.ok && check.step !== undefined && BigInt(check.step) > last) {
        await db.adminUser.update({ where: { id: admin.id }, data: { lastTotpStep: BigInt(check.step) } })
        factorOk = true
      }
    } catch {
      factorOk = false
    }
  } else if (input.secondFactor.recoveryCode) {
    const hash = recoveryCodeHash(normaliseRecoveryCode(input.secondFactor.recoveryCode))
    if (admin.recoveryCodeHashes.includes(hash)) {
      await db.adminUser.update({
        where: { id: admin.id },
        data: { recoveryCodeHashes: admin.recoveryCodeHashes.filter((h) => h !== hash) },
      })
      factorOk = true
    }
  }
  if (!factorOk) {
    await writeAudit({ action: 'auth.reset_failed', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { reason: 'second_factor' }, ip })
    throw new ApiError(401, 'Invalid second factor code', 'invalid_code')
  }

  const policy = checkPasswordPolicy(input.password, admin.email)
  if (!policy.ok) throw badRequest(policy.reason ?? 'Password does not meet the policy')

  const passwordHash = await hashPassword(input.password)
  await db.$transaction([
    db.adminUser.update({ where: { id: admin.id }, data: { passwordHash, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } }),
    db.adminPasswordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.adminPasswordReset.deleteMany({ where: { adminId: admin.id, usedAt: null } }),
  ])
  const revoked = await revokeAllSessionsForAdmin(admin.id)
  await writeAudit({ action: 'auth.password_reset', entity: 'admin', entityId: admin.id, label: maskEmail(admin.email), diff: { sessionsRevoked: revoked }, ip })
  queueSecurityAlert(ALERTS.passwordChanged(admin.email))
  return { ok: true }
}

// ── 8. Session management ───────────────────────────────────

export async function listSessions(session: AdminSession, adminId: string) {
  const rows = await db.adminSession.findMany({
    where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, stage: true, createdAt: true, lastSeenAt: true, expiresAt: true, uaHash: true },
  })
  return rows.map((s) => ({
    id: s.id,
    stage: s.stage,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === session.id,
    device: s.uaHash ? s.uaHash.slice(0, 8) : 'unknown',
  }))
}

export async function revokeOtherSessions(session: AdminSession, adminId: string, ip: string) {
  const revoked = await revokeAllSessionsForAdmin(adminId, session.id)
  await writeAudit({ action: 'auth.sessions_revoked', entity: 'admin', entityId: adminId, label: maskEmail(''), diff: { count: revoked }, ip })
  return { ok: true, revoked }
}
