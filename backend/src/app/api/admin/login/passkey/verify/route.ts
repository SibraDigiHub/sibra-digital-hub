// POST /api/admin/login/passkey/verify — verify a passkey assertion against a
// PENDING_2FA session; success ⇒ brand-new FULL session. Counter regressions
// revoke every session (possible cloned authenticator).
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { passkeyLoginVerifySchema } from '@/validators/admin-auth'
import { passkeyLoginVerify } from '@/services/admin-auth-service'
import { clientIp, resolveSession, setSessionCookies, SESSION_ABSOLUTE_MS } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const body = await parseBody(req, passkeyLoginVerifySchema)
  const resolved = await resolveSession(req)
  const result = await passkeyLoginVerify({
    email: body.email,
    response: body.response,
    session: resolved?.session ?? null,
    browserOrigin: req.headers.get('origin'),
    ip: clientIp(req),
    ua: req.headers.get('user-agent') ?? '',
  })
  await setSessionCookies(result.token, Math.floor(SESSION_ABSOLUTE_MS / 1000))
  return json({ ok: true, stage: result.stage })
})
