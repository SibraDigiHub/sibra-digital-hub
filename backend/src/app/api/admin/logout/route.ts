// POST /api/admin/logout — revoke the current session, clear both cookies.
// Always answers 200 {ok:true} even without a valid session (idempotent).
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { requireAdmin, resolveSession, revokeSessionById, clearSessionCookies, clientIp } from '@/lib/auth/session'
import { writeAudit, maskEmail } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const resolved = await resolveSession(req)
  if (resolved) {
    // Full gate (stage allowlist + CSRF) applies when a live session exists.
    await requireAdmin(req)
    await revokeSessionById(resolved.session.id)
    await writeAudit({
      action: 'auth.logout',
      entity: 'admin',
      entityId: resolved.admin.id,
      label: maskEmail(resolved.admin.email),
      req,
    })
  }
  await clearSessionCookies()
  void clientIp
  return json({ ok: true })
})
