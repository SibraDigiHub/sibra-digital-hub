// ═══════════════════════════════════════════════════════════
// T4 break-glass CLI — create the first admin (no defaults, no seeds).
// Usage:
//   bun run admin:create                                  (interactive)
//   bun run admin:create -- --email a@b.co --email-again a@b.co \
//        --password '...' --name 'Owner'                  (non-interactive)
// Prints nothing secret; writes an audit row; creates no sessions.
// ═══════════════════════════════════════════════════════════

import { parseFlags, assertPostgresEnv, requireEmailTwice, requirePassword, done } from './admin-cli-lib'

const flags = parseFlags(process.argv.slice(2))
assertPostgresEnv()

const { db } = await import('../src/lib/db')
const { checkPasswordPolicy, hashPassword } = await import('../src/lib/auth/password')
const { writeAudit } = await import('../src/lib/audit')

const email = await requireEmailTwice(flags)
const password = await requirePassword(flags, checkPasswordPolicy, email)

const existing = await db.adminUser.findUnique({ where: { email } })
if (existing) {
  console.error('ERROR: an admin with this email already exists.')
  process.exit(1)
}

const name = (flags.name || 'Owner').slice(0, 80)
await db.adminUser.create({
  data: {
    email,
    name,
    passwordHash: await hashPassword(password),
  },
})

await writeAudit({
  action: 'auth.cli_create',
  entity: 'admin',
  label: email.slice(0, 2) + '***' + email.slice(email.indexOf('@')),
  diff: { name, via: 'cli' },
  ip: 'cli-local',
})

done(`Admin created: ${email} (no second factor yet — enroll at first login)`)
