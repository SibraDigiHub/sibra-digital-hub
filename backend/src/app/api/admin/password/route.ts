// POST /api/admin/password — change password (step-up: current password
// re-entry). Revokes every OTHER session; the current one stays alive.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { changePasswordSchema } from '@/validators/admin-auth'
import { changePassword } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  const body = await parseBody(req, changePasswordSchema)
  const result = await changePassword(session, admin, body.currentPassword, body.newPassword, clientIp(req))
  return json(result)
})
