// POST /api/admin/orders/[id]/watch-preview — "Preview as buyer" (T-V C).
// Mints a short-lived (30 min) preview grant for the paid watch-mode order
// and returns the plain token EXACTLY ONCE. The real buyer token is never
// re-revealed to anyone. Audit-logged.
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { mintPreviewGrant } from '@/services/watch-service'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  return json(await mintPreviewGrant(id))
})
