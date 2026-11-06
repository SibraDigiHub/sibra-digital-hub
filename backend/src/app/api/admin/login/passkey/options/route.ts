// POST /api/admin/login/passkey/options — WebAuthn assertion options for the
// passkey second factor. Unknown emails get identical-looking options (no
// enumeration); verification later fails generically.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { passkeyLoginOptionsSchema } from '@/validators/admin-auth'
import { passkeyLoginOptions } from '@/services/admin-auth-service'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const body = await parseBody(req, passkeyLoginOptionsSchema)
  const result = await passkeyLoginOptions(body.email, req.headers.get('origin'), clientIp(req))
  return json(result)
})
