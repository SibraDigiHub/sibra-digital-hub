// POST /api/admin/reset-password — token + new password + second factor
// (TOTP or recovery code). Success ⇒ password changed, ALL sessions revoked,
// every reset token invalidated, audit + alert. Rate limited 5/15min per IP+token.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { resetPasswordSchema } from '@/validators/admin-auth'
import { resetPassword } from '@/services/admin-auth-service'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const body = await parseBody(req, resetPasswordSchema)
  const result = await resetPassword({
    token: body.token,
    password: body.password,
    secondFactor: body.secondFactor,
    ip: clientIp(req),
  })
  return json(result)
})
