// GET    /api/admin/sessions — list live sessions (device ≈ uaHash prefix, current marker)
// DELETE /api/admin/sessions — revoke all OTHER sessions (the current one stays).
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { requireAdmin, clientIp } from '@/lib/auth/session'
import { listSessions, revokeOtherSessions } from '@/services/admin-auth-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  return json({ sessions: await listSessions(session, admin.id) })
})

export const DELETE = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  return json(await revokeOtherSessions(session, admin.id, clientIp(req)))
})
