// DELETE /api/admin/sessions/[id] — revoke one other session.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { requireAdmin, revokeSession } from '@/lib/admin-session'
import { logSecurityEvent } from '@/lib/security-audit'

export const dynamic = 'force-dynamic'

export const DELETE = asHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireAdmin(req, { mutating: true })
  if (auth instanceof NextResponse) return auth
  const { session, admin } = auth

  const { id } = await ctx.params
  if (id === session.id) {
    return NextResponse.json({ error: 'Use logout to end the current session' }, { status: 400 })
  }
  await revokeSession(id, admin.id)
  await logSecurityEvent({ adminId: admin.id, action: 'auth.session_revoked', req, label: id })

  const res = NextResponse.json({ ok: true })
  res.headers.set('Cache-Control', 'no-store')
  return res
})
