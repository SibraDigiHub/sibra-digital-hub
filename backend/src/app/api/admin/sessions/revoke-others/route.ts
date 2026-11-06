// POST /api/admin/sessions/revoke-others — log out all OTHER sessions.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { requireAdmin, revokeAllSessions } from '@/lib/admin-session'
import { logSecurityEvent } from '@/lib/security-audit'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req, { mutating: true })
  if (auth instanceof NextResponse) return auth
  const { session, admin } = auth

  const revoked = await revokeAllSessions(admin.id, session.id)
  await logSecurityEvent({ adminId: admin.id, action: 'auth.sessions_revoked_all', req, meta: { revoked } })

  const res = NextResponse.json({ ok: true, revoked })
  res.headers.set('Cache-Control', 'no-store')
  return res
})
