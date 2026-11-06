// PATCH  /api/admin/reviews/product/[id] — approve/reject { status }
// DELETE /api/admin/reviews/product/[id] — hard delete
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody, unauthorized } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { deleteReview, moderateReview } from '@/services/review-service'
import { reviewModerationSchema } from '@/validators/review'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = asHandler(async (req: NextRequest, ctx: Ctx) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await ctx.params
  const { status } = await parseBody(req, reviewModerationSchema)
  return json(await moderateReview(id, status, req))
})

export const DELETE = asHandler(async (req: NextRequest, ctx: Ctx) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await ctx.params
  return json(await deleteReview(id, req))
})
