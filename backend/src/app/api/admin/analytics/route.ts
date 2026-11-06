// GET /api/admin/analytics?days=7|30|90 — dashboard aggregates
// (PRD v6.1 §11.1 + §11.7): funnel, top products, platform click
// share, device/country split, revenue series and a live feed.
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { requireAdmin } from '@/lib/auth/session'
import { analyticsWindow } from '@/services/analytics-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') || '7', 10) || 7, 1), 365)
  return json(await analyticsWindow(days))
})
