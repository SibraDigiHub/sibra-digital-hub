// T-V Feature C — admin management of a paid order's protected watch link.
// GET   /api/admin/orders/[id]/watch          — grant status (expiry, lock, sessions, networks)
// PATCH /api/admin/orders/[id]/watch          — { action: 'revoke' | 'unlock' | 'extend' | 'renew', hours? }
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { adminWatchAction, adminWatchStatus } from '@/services/watch-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const actionSchema = z.object({
  action: z.enum(['revoke', 'unlock', 'extend', 'renew']),
  hours: z.coerce.number().int().min(1).max(24 * 30).optional(),
})

export const GET = asHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  return json({ watch: await adminWatchStatus(id) })
})

export const PATCH = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  const input = await parseBody(req, actionSchema)
  return json(await adminWatchAction(id, input.action, { hours: input.hours }))
})
