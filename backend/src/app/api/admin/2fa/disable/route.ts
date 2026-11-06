// POST /api/admin/2fa/disable — remove TOTP (step-up: password re-entry).
// Refused when TOTP is the only remaining second factor.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { totpDisableSchema } from '@/validators/admin-auth'
import { disableTotp } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  const body = await parseBody(req, totpDisableSchema)
  return json(await disableTotp(session, admin, body.password, clientIp(req)))
})
