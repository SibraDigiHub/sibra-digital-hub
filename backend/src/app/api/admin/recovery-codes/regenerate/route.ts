// POST /api/admin/recovery-codes/regenerate — 10 new single-use codes, shown
// exactly once; all previous codes are invalidated (step-up: password re-entry;
// the restricted ENROLL stage is pre-authorized).
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { recoveryRegenSchema } from '@/validators/admin-auth'
import { regenerateRecoveryCodes } from '@/services/admin-auth-service'
import { requireAdmin, clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  const { session, admin } = await requireAdmin(req)
  const body = await parseBody(req, recoveryRegenSchema)
  const result = await regenerateRecoveryCodes(session, admin, body.password, clientIp(req))
  return json({ ok: true, codes: result.codes, remaining: result.remaining })
})
