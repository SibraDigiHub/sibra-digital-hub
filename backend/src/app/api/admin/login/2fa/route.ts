// POST /api/admin/login/2fa — complete a PENDING_2FA login with a TOTP code
// or a single-use recovery code. Success ⇒ BRAND-NEW FULL session (fresh
// token + CSRF), the pending row is deleted (anti session fixation).
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody, unauthorized } from '@/lib/api'
import { login2faSchema } from '@/validators/admin-auth'
import { verifyLogin2fa } from '@/services/admin-auth-service'
import { clientIp, resolveSession, setSessionCookies, SESSION_ABSOLUTE_MS } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const body = await parseBody(req, login2faSchema)
  const resolved = await resolveSession(req)
  if (!resolved || resolved.session.stage !== 'PENDING_2FA') throw unauthorized()
  const result = await verifyLogin2fa({
    session: resolved.session,
    admin: resolved.admin,
    code: body.code,
    recoveryCode: body.recoveryCode,
    ip: clientIp(req),
    ua: req.headers.get('user-agent') ?? '',
  })
  await setSessionCookies(result.token, Math.floor(SESSION_ABSOLUTE_MS / 1000))
  return json({ ok: true, stage: result.stage })
})
