// POST /api/admin/login — email + password → PENDING_2FA / ENROLL / FULL session.
// Generic error for every failure (never reveals whether the email exists).
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { loginSchema } from '@/validators/admin-auth'
import { loginWithEmail } from '@/services/admin-auth-service'
import { clientIp, setSessionCookies, PENDING_2FA_MS, SESSION_ABSOLUTE_MS, STAGE_PENDING_2FA } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const body = await parseBody(req, loginSchema)
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') ?? ''
  const result = await loginWithEmail({ email: body.email, password: body.password, ip, ua })
  await setSessionCookies(result.token, result.stage === STAGE_PENDING_2FA ? Math.floor(PENDING_2FA_MS / 1000) : Math.floor(SESSION_ABSOLUTE_MS / 1000))
  logger.info({ stage: result.stage }, 'admin login')
  return json({ ok: true, stage: result.stage })
})
