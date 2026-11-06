// POST /api/admin/step-up — password re-entry for sensitive ops.
// Marks the session as step-up-verified for 10 minutes.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { asHandler } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { requireAdmin, markStepUp } from '@/lib/admin-session'
import { verifyPassword } from '@/lib/password'
import { logSecurityEvent } from '@/lib/security-audit'
import { GENERIC_LOGIN_ERROR, parseJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

const bodySchema = z.strictObject({
  password: z.string().min(1).max(128),
})

export const POST = asHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req, { mutating: true })
  if (auth instanceof NextResponse) return auth
  const { session, admin } = auth

  const rl = await rateLimit(`stepup:sess:${session.id}:w5`, 5, 5 * 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 })
  }

  const body = await parseJsonBody(req, bodySchema)
  if (body instanceof NextResponse) return body

  const ok = await verifyPassword(body.password, admin.passwordHash)
  if (!ok) {
    await logSecurityEvent({ adminId: admin.id, action: 'auth.stepup_failed', req })
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 403 })
  }

  await markStepUp(session.id)
  const res = NextResponse.json({ ok: true, validForMinutes: 10 })
  res.headers.set('Cache-Control', 'no-store')
  return res
})
