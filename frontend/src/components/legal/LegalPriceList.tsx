'use client'

// ═══════════════════════════════════════════════════════════
// Legal price list (Pricing page) — the LIVE catalog pulled
// from the public products API, grouped by zone. Same design
// language as LegalTable: bordered table on desktop, stacked
// glass cards on phones. Prices show ₹ (India primary) and $
// (international) exactly like the shop cards do.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'

import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/types/marketplace'
import type { Product } from '@/types/marketplace'

function ZoneTable({
  heading,
  emoji,
  products,
  onOpen,
}: {
  heading: string
  emoji: string
  products: Product[]
  onOpen: (slug: string) => void
}) {
  if (products.length === 0) return null
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">
        {emoji} {heading}
      </h3>

      {/* Desktop: real table */}
      <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-[rgba(229,184,66,0.25)] md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-[#E5B842]/10">
              <th scope="col" className="px-4 py-3 font-bold text-[#FAE8A7]">
                Product
              </th>
              <th scope="col" className="px-4 py-3 font-bold text-[#FAE8A7]">
                India (₹)
              </th>
              <th scope="col" className="px-4 py-3 font-bold text-[#FAE8A7]">
                International ($)
              </th>
              <th scope="col" className="px-4 py-3 font-bold text-[#FAE8A7]">
                <span className="sr-only">Open product</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const money = formatMoney(p.priceUsd, p.priceInr)
              return (
                <tr key={p.id} className="border-t border-white/10 align-top">
                  <td scope="row" className="px-4 py-3 font-semibold text-[#F5F8F6]">
                    {p.title}
                  </td>
                  <td className="px-4 py-3 font-bold text-[#E67300]">{money.inr}</td>
                  <td className="px-4 py-3 text-[#C7D0C9]">{money.usd}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(p.slug)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[rgba(229,184,66,0.4)] px-3 text-xs font-semibold text-[#E5B842] transition-colors hover:bg-[#E5B842]/10 focus-visible:outline-none"
                    >
                      View
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked labelled cards */}
      <div className="mt-3 space-y-3 md:hidden">
        {products.map((p) => {
          const money = formatMoney(p.priceUsd, p.priceInr)
          return (
            <div key={p.id} className="glass rounded-2xl px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-bold text-[#FAE8A7]">{p.title}</p>
                <button
                  type="button"
                  onClick={() => onOpen(p.slug)}
                  aria-label={`Open ${p.title}`}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(229,184,66,0.4)] text-[#E5B842] focus-visible:outline-none"
                >
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-lg font-extrabold text-[#E67300]">{money.inr}</span>
                <span className="text-xs font-semibold text-[#9AA89E]">{money.usd}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function LegalPriceList() {
  const navigate = useAppStore((s) => s.navigate)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/products?status=active&limit=100', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((data: { products?: Product[] } | null) => {
        if (!alive) return
        setProducts(Array.isArray(data?.products) ? data.products : [])
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const open = (slug: string) => navigate('product', { productSlug: slug })

  if (failed) {
    return (
      <p className="glass mt-6 rounded-2xl px-5 py-4 text-sm text-[#C7D0C9]">
        The live list could not be loaded right now — every product and its price is
        always visible in the shop itself.
      </p>
    )
  }

  if (products === null) {
    return (
      <div className="mt-6 flex items-center gap-3 text-sm text-[#9AA89E]">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading current prices…
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <p className="glass mt-6 rounded-2xl px-5 py-4 text-sm text-[#C7D0C9]">
        The catalog is being updated — please check the shop for current products and
        prices.
      </p>
    )
  }

  const kids = products
    .filter((p) => p.zone === 'kids')
    .sort((a, b) => a.title.localeCompare(b.title))
  const creator = products
    .filter((p) => p.zone === 'creator')
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="mt-2">
      <ZoneTable heading="Kids Zone — Digital Kidosphere" emoji="🎨" products={kids} onOpen={open} />
      <ZoneTable heading="Creator & Developer Hub" emoji="⚡" products={creator} onOpen={open} />
      <p className="mt-6 text-xs leading-relaxed text-[#9AA89E]">
        All prices are for one-time purchases delivered as instant digital downloads.
        The shop shows the same prices — open any product to buy.
      </p>
    </div>
  )
}
