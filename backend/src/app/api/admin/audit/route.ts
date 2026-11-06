// GET /api/admin/audit — audit trail (who changed what, latest first)
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)
  const q = (req.nextUrl.searchParams.get('q') || '').toLowerCase()
  const logs = await db.auditLog.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 300 })
  const filtered = q
    ? logs.filter(
        (l) =>
          l.action.toLowerCase().includes(q) ||
          l.entity.toLowerCase().includes(q) ||
          (l.label ?? '').toLowerCase().includes(q),
      )
    : logs
  return json({ logs: filtered })
})
