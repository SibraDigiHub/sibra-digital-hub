// GET /api/admin/session — current session info: { authenticated, stage, user,
// csrfToken, security status }. Unauthenticated requests answer
// { authenticated: false } (200) so the admin shell can probe cheaply.
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { db } from '@/lib/db'
import { resolveSession } from '@/lib/auth/session'
import { adminRequire2fa, adminPasskeysEnabled } from '@/config/env'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const resolved = await resolveSession(req)
  if (!resolved) return json({ authenticated: false })
  const { session, admin } = resolved
  const passkeyCount = await db.adminPasskey.count({ where: { adminId: admin.id } })
  return json({
    authenticated: true,
    stage: session.stage,
    user: { id: admin.id, name: admin.name, email: admin.email },
    csrfToken: session.csrfHash,
    security: {
      totpEnabled: admin.totpEnabled,
      passkeys: passkeyCount,
      recoveryCodesRemaining: admin.recoveryCodeHashes.length,
      require2fa: adminRequire2fa(),
      passkeysEnabled: adminPasskeysEnabled(),
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      passwordChangedAt: admin.passwordChangedAt?.toISOString() ?? null,
    },
  })
})
