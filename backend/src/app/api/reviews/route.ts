// GET/POST/DELETE /api/reviews — testimonials (public read, admin write)
import { NextRequest } from 'next/server'
import { asHandler, cachedJson, json, parseBody, badRequest } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { reviewRepo } from '@/repositories/content-repo'
import { createReview, reviewCreateSchema } from '@/services/content-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const reviews = await reviewRepo.listAll()
  return cachedJson(req, { reviews })
})

export const POST = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const input = await parseBody(req, reviewCreateSchema)
  const review = await createReview(input)
  return json({ review }, { status: 201 })
})

export const DELETE = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) throw badRequest('id required')
  await reviewRepo.remove(id)
  return json({ ok: true })
})
