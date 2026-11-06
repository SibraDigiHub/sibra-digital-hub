// GET /api/admin/stats — dashboard counters, revenue KPIs,
// operational alerts + recent orders
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { requireAdmin } from '@/lib/auth/session'
import { dashboardStats } from '@/services/analytics-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)
  return json(await dashboardStats())
})
