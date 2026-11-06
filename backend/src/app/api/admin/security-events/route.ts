// GET /api/admin/security-events — read-only recent security
// events for the signed-in admin (Security page).
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-session'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { admin } = auth

  const events = await db.auditLog.findMany({
    where: { adminId: admin.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
    select: {
      id: true,
      action: true,
      label: true,
      createdAt: true,
    },
  })

  const res = NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      label: e.label,
      createdAt: e.createdAt.toISOString(),
    })),
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
})
