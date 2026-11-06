'use client'

// Dynamic published-product showcase.
// Real product images only — no static category placeholder covers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { parseProduct } from '@/lib/parse-product'
import { productMediaImages } from '@/lib/video-thumb'
import { playFx } from '@/lib/sound-fx'
import { useMarqueeFallback } from '@/hooks/useMarqueeFallback'
import { hydrateCategories, useZoneCategories } from '@/lib/categories'
import type { Product, ProductRow, Zone } from '@/types/marketplace'

interface JourneyCard {
  product: Product
  cover: string
  emoji: string
  blurb: string
}

/** Reveal-on-scroll for the section header */
function useHeaderReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return

    const els = Array.from(root.querySelectorAll<HTMLElement>('.reveal'))

    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('revealed'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).classList.add('revealed')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.25 },
    )

    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return ref
}

export default function JourneySlider() {
  const headerRef = useHeaderReveal<HTMLElement>()
  const trackRef = useRef<HTMLDivElement | null>(null)
  const lastPop = useRef(0)

  const [products, setProducts] = useState<Product[]>([])

  // Keep the existing continuous RTL marquee behaviour.
  useMarqueeFallback(trackRef, 55)

  // Load real products from both public storefront zones.
  useEffect(() => {
    const controller = new AbortController()

    void hydrateCategories()

    async function loadProducts() {
      const zones: Zone[] = ['kids', 'creator']

      const results = await Promise.all(
        zones.map(async (zone) => {
          try {
            const params = new URLSearchParams({
              zone,
              sort: 'featured',
              limit: '60',
            })

            const response = await fetch(
              `/api/products?${params.toString()}`,
              { signal: controller.signal },
            )

            if (!response.ok) return []

            const data = (await response.json()) as {
              products?: ProductRow[]
            }

            return (data.products ?? []).map((row) =>
              parseProduct(
                row as unknown as Record<string, unknown>,
              ) as unknown as Product,
            )
          } catch (error) {
            if ((error as Error).name === 'AbortError') {
              return []
            }
            return []
          }
        }),
      )

      if (!controller.signal.aborted) {
        setProducts(results.flat())
      }
    }

    void loadProducts()

    return () => controller.abort()
  }, [])

  const kidsCats = useZoneCategories('kids')
  const creatorCats = useZoneCategories('creator')

  // Only show published products that have real usable media.
  const cards = useMemo<JourneyCard[]>(() => {
    return products.flatMap((product) => {
      if (product.status !== 'published') return []

      const cover = productMediaImages(product).find(
        (image) => typeof image === 'string' && image.trim().length > 0,
      )

      // No dummy image fallback.
      if (!cover) return []

      const categories =
        product.zone === 'kids' ? kidsCats : creatorCats

      const category = categories.find(
        (item) => item.slug === product.category,
      )

      return [{
        product,
        cover,
        emoji: category?.emoji ?? (
          product.zone === 'kids' ? '📚' : '✨'
        ),
        blurb: category?.blurb ?? 'Explore this product',
      }]
    })
  }, [products, kidsCats, creatorCats])

  /** Throttled pop sound on card hover/focus */
  const handleCardEnter = useCallback(() => {
    const now = Date.now()

    if (now - lastPop.current > 300) {
      lastPop.current = now
      playFx('pop')
    }
  }, [])

  /** Open the actual product detail page */
  const handleCardClick = useCallback((slug: string) => {
    playFx('whoosh')
    useAppStore.getState().navigate('product', {
      productSlug: slug,
    })
  }, [])

  // Do not display the old category showcase or dummy covers.
  // The section appears automatically when real published products exist.
  if (cards.length === 0) return null

  const renderSet = (copy: 'main' | 'ghost') => (
    <div
      className="flex shrink-0 gap-6 pr-6"
      aria-hidden={copy === 'ghost' || undefined}
    >
      {cards.map((card, index) => (
        <button
          key={`${copy}-${card.product.id}-${index}`}
          type="button"
          tabIndex={copy === 'ghost' ? -1 : 0}
          onClick={() => handleCardClick(card.product.slug)}
          onMouseEnter={handleCardEnter}
          onFocus={handleCardEnter}
          aria-label={`View ${card.product.title}`}
          className={`journey-item group w-56 shrink-0 overflow-hidden rounded-3xl text-left transition-shadow duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E5B842] md:w-64 ${
            card.product.zone === 'kids'
              ? 'bg-[#FFF8E7] shadow-[0_10px_30px_rgba(255,136,0,0.18)] hover:shadow-[0_18px_44px_rgba(255,136,0,0.32)]'
              : 'border border-[#00F0FF]/35 bg-[#0D0D0D] shadow-[0_10px_30px_rgba(0,240,255,0.10)] hover:border-[#00F0FF]/70 hover:shadow-[0_18px_44px_rgba(0,240,255,0.22)]'
          }`}
        >
          <span className="block aspect-[4/3] overflow-hidden bg-black/5">
            <img
              src={card.cover}
              alt={`${card.product.title} product cover`}
              width={640}
              height={480}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            />
          </span>

          <span
            className={`block p-4 ${
              card.product.zone === 'kids'
                ? 'bg-gradient-to-b from-[#FFF8E7] to-[#FFF2CC] text-[#4a3b2a]'
                : 'bg-[#0D0D0D] text-[#E8F6F2]'
            }`}
          >
            <span
              className={`flex items-center gap-2 text-sm font-bold md:text-base ${
                card.product.zone === 'kids'
                  ? 'font-baloo'
                  : 'font-jetbrains'
              }`}
            >
              <span aria-hidden="true">{card.emoji}</span>
              <span className="line-clamp-1">
                {card.product.title}
              </span>
            </span>

            <span
              className={`mt-1.5 block text-xs ${
                card.product.zone === 'kids'
                  ? 'text-[#6b4e26]'
                  : 'text-[#6FA7A0]'
              }`}
            >
              {card.blurb}
            </span>

            <span
              className="mono-tag mt-3 inline-block"
              style={
                card.product.zone === 'kids'
                  ? {
                      color: '#8c6a1e',
                      borderColor: 'rgba(229, 184, 66, 0.5)',
                      background: 'rgba(229, 184, 66, 0.1)',
                    }
                  : undefined
              }
            >
              View Product →
            </span>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <section
      ref={headerRef}
      aria-labelledby="journey-heading"
      className="relative py-16 md:py-24"
    >
      {/* Section header */}
      <div className="reveal mx-auto max-w-3xl px-4 text-center">
        <p className="sec-eyebrow font-jetbrains text-xs font-semibold tracking-[0.3em] text-[#E5B842]">
          ── TAKE THE TOUR ──
        </p>

        <h2
          id="journey-heading"
          className="sec-heading chameleon-sweep font-playfair mt-4 text-3xl leading-tight font-semibold text-foreground md:text-5xl"
        >
          A <span className="holo-text">Journey</span> Through Learning
          <br className="hidden md:block" /> &amp; Creation
        </h2>

        <p className="shop-sub mt-4 text-sm text-muted-foreground md:text-base">
          Discover our latest published treasures across Kids and Creator worlds.
          Tap any cover to explore the product.
        </p>
      </div>

      {/* Infinite RTL product marquee */}
      <div className="relative mt-10 md:mt-14">
        <div className="journey-wrap w-full overflow-hidden">
          <div ref={trackRef} className="journey-track" style={{ gap: 0 }}>
            {renderSet('main')}
            {renderSet('ghost')}
          </div>
        </div>

        {/* Edge fades */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[var(--edge-fade)] to-transparent sm:w-20"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--edge-fade)] to-transparent sm:w-20"
        />
      </div>
    </section>
  )
}
