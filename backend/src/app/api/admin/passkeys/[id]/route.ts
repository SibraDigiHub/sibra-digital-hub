// DELETE /api/admin/passkeys/[id] — remove one passkey (step-up: password in
// the JSON body). Refused when it is the last remaining second factor.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { passkeyDeleteSchema } from '@/validators/admin-auth'
import { deletePasskey } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const DELETE = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { session, admin } = await requireAdmin(req)
  const { id } = await params
  const body = await parseBody(req, passkeyDeleteSchema)
  return json(await deletePasskey(session, admin, id, body.password, clientIp(req)))
})
