// ═══════════════════════════════════════════════════════════
// T4 break-glass CLI — set a new admin password (lost password).
// Revokes ALL sessions, invalidates reset tokens, keeps 2FA as is,
// writes an audit row, prints nothing secret.
// Usage:
//   bun run admin:reset-password                          (interactive)
//   bun run admin:reset-password -- --email a@b.co --email-again a@b.co --password '...'
// ═══════════════════════════════════════════════════════════

import { parseFlags, assertPostgresEnv, requireEmailTwice, requirePassword, done } from './admin-cli-lib'

const flags = parseFlags(process.argv.slice(2))
assertPostgresEnv()

const { db } = await import('../src/lib/db')
const { checkPasswordPolicy, hashPassword } = await import('../src/lib/auth/password')
const { writeAudit } = await import('../src/lib/audit')

const email = await requireEmailTwice(flags)
const admin = await db.adminUser.findUnique({ where: { email } })
if (!admin) {
  console.error('ERROR: no admin found with this email.')
  process.exit(1)
}
const password = await requirePassword(flags, checkPasswordPolicy, email)

await db.$transaction([
  db.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
  }),
  db.adminPasswordReset.deleteMany({ where: { adminId: admin.id } }),
])
const revoked = await db.adminSession.updateMany({
  where: { adminId: admin.id, revokedAt: null },
  data: { revokedAt: new Date() },
})

await writeAudit({
  action: 'auth.cli_password_reset',
  entity: 'admin',
  entityId: admin.id,
  label: email.slice(0, 2) + '***' + email.slice(email.indexOf('@')),
  diff: { sessionsRevoked: revoked.count, via: 'cli' },
  ip: 'cli-local',
})

done(`Password updated for ${email}. All ${revoked.count} live session(s) revoked.`)
