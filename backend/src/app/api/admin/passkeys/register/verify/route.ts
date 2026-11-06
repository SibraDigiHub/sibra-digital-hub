// POST /api/admin/passkeys/register/verify — verify the attestation response,
// store the credential (public key + monotonic counter), auto-issue recovery
// codes when this is the admin's first factor.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { passkeyRegisterVerifySchema } from '@/validators/admin-auth'
import { passkeyRegisterVerify } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  const body = await parseBody(req, passkeyRegisterVerifySchema)
  return json(await passkeyRegisterVerify(session, admin, req.headers.get('origin'), body.response, body.name, clientIp(req)))
})
