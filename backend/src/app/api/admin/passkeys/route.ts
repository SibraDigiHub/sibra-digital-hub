// GET /api/admin/passkeys — list the admin's registered passkeys.
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { requireAdmin } from '@/lib/auth/session'
import { listPasskeys } from '@/services/admin-auth-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const { admin } = await requireAdmin(req)
  return json({ passkeys: await listPasskeys(admin.id) })
})
