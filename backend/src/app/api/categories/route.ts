// GET /api/categories — public category registry (T10).
// Powers the storefront chips, product-form options, journey slider
// and label lookups. Active categories only; admins use
// /api/admin/categories for the full list with product counts.
import { NextRequest } from 'next/server'
import { asHandler, cachedJson, json, parseQuery } from '@/lib/api'
import { hasAdminSessionCookie } from '@/lib/admin-auth'
import { listPublicCategories } from '@/services/category-service'
import { categoryListQuerySchema } from '@/validators/category'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const query = parseQuery(req, categoryListQuerySchema)
  const body = { categories: await listPublicCategories(query.zone) }
  // Admin sessions bypass the ETag cache so panel edits show up
  // instantly; everyone else gets the 60s public cache policy.
  if (hasAdminSessionCookie(req)) return json(body)
  return cachedJson(req, body, { varyCookie: true })
})
