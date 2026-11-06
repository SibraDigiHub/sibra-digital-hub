// POST /api/admin/orders/[id]/reconcile — admin "Reconcile now" (§9).
// Queries the gateway for ONE order and fulfils/expires it if warranted.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, notFound, unauthorized } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { reconcileOrder } from '@/services/reconcile-service'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  const result = await reconcileOrder(id)
  if (result.action === 'skipped' && result.detail === 'not_found') throw notFound('Order not found')
  await writeAudit({ action: 'order.reconciled', entity: 'order', entityId: id, diff: { ...result } })
  return NextResponse.json({ ok: true, ...result })
})
