// POST /api/admin/2fa/confirm — finish TOTP enrollment with a valid code.
// Enables TOTP, stamps the replay-guard step, and (first factor only) returns
// the 10 recovery codes — shown exactly once.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { totpConfirmSchema } from '@/validators/admin-auth'
import { confirmTotpEnrollment } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  const body = await parseBody(req, totpConfirmSchema)
  return json(await confirmTotpEnrollment(session, admin, body.code, clientIp(req)))
})
