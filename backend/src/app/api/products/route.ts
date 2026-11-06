// GET  /api/products — public catalog (published) + admin (status=all)
// POST /api/products — admin create
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, cachedJson, json, parseBody, parseQuery } from '@/lib/api'
import { hasAdminSessionCookie, isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { ensureVisitorId, eventContext, logEvent } from '@/lib/activity'
import { writeAudit } from '@/lib/audit'
import { productRepo } from '@/repositories/product-repo'
import { createProduct, listCatalog, toPublicProductDTO } from '@/services/product-service'
import { productInputSchema, productListQuerySchema } from '@/validators/product'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const query = parseQuery(req, productListQuerySchema)

  // Slug lookup (public, published only) — returns both shapes for compatibility.
  // T5 (§6.5): public detail never carries paid file references.
  if (query.slug) {
    const row = await productRepo.findBySlug(query.slug, 'published')
    const product = row ? toPublicProductDTO(row) : null
    const body = {
      product: product ?? null,
      products: product ? [product] : [],
    }
    if (product) {
      // Anonymous product-view event — feeds the admin funnel + customer timeline
      try {
        const ctx = eventContext(req)
        if (ctx.device !== 'bot') {
          const probe = new NextResponse(null)
          const visitorId = ensureVisitorId(req, probe)
          // Only count a fresh view (a 304 means the client already had it) and
          // only attach the visitor cookie when the response is a full 200.
          const cached = cachedJson(req, body, { varyCookie: true })
          if (cached.status === 200) {
            const cookie = probe.headers.get('set-cookie')
            if (cookie) cached.headers.append('set-cookie', cookie)
            await logEvent({
              type: 'product_view',
              productId: product.id,
              zone: product.zone,
              visitorId,
              path: ctx.path,
              referrer: ctx.referrer,
              country: ctx.country,
              device: ctx.device,
            })
          }
          return cached
        }
      } catch {
        // analytics never breaks the catalog
      }
    }
    return cachedJson(req, body, { varyCookie: true })
  }

  const products = await listCatalog(query, req)
  // Admin requests (session cookie) see drafts/trash → must never be cached.
  if (hasAdminSessionCookie(req)) return json({ products })
  return cachedJson(req, { products }, { varyCookie: true })
})

export const POST = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const input = await parseBody(req, productInputSchema)
  const product = await createProduct(input)
  await writeAudit({ action: 'product.create', entity: 'product', entityId: product.id, label: product.title, req })
  return json({ product }, { status: 201 })
})
