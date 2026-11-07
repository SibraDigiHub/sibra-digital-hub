// POST /api/products/[id]/duplicate — admin duplicates a product
import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req)
  const { id } = await params
  try {
    const src = await db.product.findUnique({ where: { id } })
    if (!src) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    let slug = `${src.slug}-copy`
    let n = 2
    while (await db.product.findUnique({ where: { slug } })) slug = `${src.slug}-copy-${n++}`

    const { id: _omit, createdAt: _c, updatedAt: _u, ...data } = src
    void _omit
    void _c
    void _u
    const product = await db.product.create({ data: { ...data, slug, title: `${src.title} (Copy)`, status: 'draft' } })
    await writeAudit({ action: 'product.duplicate', entity: 'product', entityId: product.id, label: product.title, diff: { from: src.slug }, req })
    return NextResponse.json({ product }, { status: 201 })
  } catch (e) {
    logger.error({ err: e }, 'duplicate failed')
    return NextResponse.json({ error: 'Failed to duplicate' }, { status: 500 })
  }
})
