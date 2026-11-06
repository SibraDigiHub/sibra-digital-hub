// POST /api/admin/2fa/enroll — start TOTP enrollment: returns the base32
// secret, otpauth:// URL and a QR (data URL). The secret is stored encrypted
// (AES-256-GCM) but NOT enabled until /api/admin/2fa/confirm.
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { totpEnrollSchema } from '@/validators/admin-auth'
import { startTotpEnrollment } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  parseBody(req, totpEnrollSchema) // strict empty body
  return json(await startTotpEnrollment(session, admin, clientIp(req)))
})
