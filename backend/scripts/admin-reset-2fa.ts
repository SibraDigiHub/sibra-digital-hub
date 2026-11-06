// ═══════════════════════════════════════════════════════════
// T4 break-glass CLI — reset 2FA (lost phone AND lost recovery codes).
// Clears TOTP + passkeys + recovery codes, revokes all sessions; the next
// login re-enters the restricted enrollment flow. Writes an audit row.
// Usage:
//   bun run admin:reset-2fa                               (interactive)
//   bun run admin:reset-2fa -- --email a@b.co --email-again a@b.co
// ═══════════════════════════════════════════════════════════

import { parseFlags, assertPostgresEnv, requireEmailTwice, done } from './admin-cli-lib'

const flags = parseFlags(process.argv.slice(2))
assertPostgresEnv()

const { db } = await import('../src/lib/db')
const { writeAudit } = await import('../src/lib/audit')

const email = await requireEmailTwice(flags)
const admin = await db.adminUser.findUnique({ where: { email } })
if (!admin) {
  console.error('ERROR: no admin found with this email.')
  process.exit(1)
}

await db.$transaction([
  db.adminUser.update({
    where: { id: admin.id },
    data: { totpEnabled: false, totpSecretEnc: null, lastTotpStep: null, recoveryCodeHashes: [], failedLogins: 0, lockedUntil: null },
  }),
  db.adminPasskey.deleteMany({ where: { adminId: admin.id } }),
  db.adminWebauthnChallenge.deleteMany({ where: { adminId: admin.id } }),
])
const revoked = await db.adminSession.updateMany({
  where: { adminId: admin.id, revokedAt: null },
  data: { revokedAt: new Date() },
})

await writeAudit({
  action: 'auth.cli_2fa_reset',
  entity: 'admin',
  entityId: admin.id,
  label: email.slice(0, 2) + '***' + email.slice(email.indexOf('@')),
  diff: { sessionsRevoked: revoked.count, via: 'cli' },
  ip: 'cli-local',
})

done(`2FA reset for ${email}. The next login will force re-enrollment (restricted session).`)
