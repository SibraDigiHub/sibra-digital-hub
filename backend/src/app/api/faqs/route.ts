// GET/POST/DELETE /api/faqs — FAQ items (public read, admin write)
import { NextRequest } from 'next/server'
import { asHandler, cachedJson, json, parseBody, badRequest } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { faqRepo } from '@/repositories/content-repo'
import { createFaq, faqCreateSchema } from '@/services/content-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const faqs = await faqRepo.listAll()
  return cachedJson(req, { faqs })
})

export const POST = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const input = await parseBody(req, faqCreateSchema)
  const faq = await createFaq(input)
  return json({ faq }, { status: 201 })
})

export const DELETE = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) throw badRequest('id required')
  await faqRepo.remove(id)
  return json({ ok: true })
})
