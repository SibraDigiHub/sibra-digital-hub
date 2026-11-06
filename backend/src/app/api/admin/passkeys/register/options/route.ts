// POST /api/admin/passkeys/register/options — WebAuthn registration options
// (attestation none, residentKey preferred, userVerification required).
// Challenges are single-use with a 5-minute TTL (AdminWebauthnChallenge).
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { totpEnrollSchema } from '@/validators/admin-auth'
import { passkeyRegisterOptions } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  parseBody(req, totpEnrollSchema) // strict empty body
  return json(await passkeyRegisterOptions(session, admin, req.headers.get('origin'), clientIp(req)))
})
