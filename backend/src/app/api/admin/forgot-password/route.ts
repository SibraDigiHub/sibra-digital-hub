// POST /api/admin/forgot-password — always 200 with the same message,
// equal work for unknown emails (dummy hash + fake token), rate limited
// 3/hour per IP and per email. The reset email is sent AFTER the response.
import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { forgotPasswordSchema } from '@/validators/admin-auth'
import { requestPasswordReset } from '@/services/admin-auth-service'
import { clientIp } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const body = await parseBody(req, forgotPasswordSchema)
  const ip = clientIp(req)
  const result = await requestPasswordReset({ email: body.email, ip })

  if (result.resetLink && result.adminEmail) {
    const link = result.resetLink
    const to = result.adminEmail
    // Fire-and-forget AFTER the response is committed (never blocks, never leaks).
    after(async () => {
      const { sendSecurityAlertEmail } = await import('@/lib/email')
      const res = await sendSecurityAlertEmail(
        to,
        'Password reset link',
        [
          'Use the link below to reset your admin password (it also asks for a second factor):',
          link,
          `This link expires in ${process.env.ADMIN_RESET_TTL_MINUTES || '30'} minutes and can be used once.`,
        ],
      )
      logger.info({ sent: res.sent, demo: res.demo }, 'admin password reset email')
    })
  }
  return json({ ok: true, message: result.message })
})
