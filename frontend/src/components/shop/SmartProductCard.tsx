'use client'

// ═══════════════════════════════════════════════════════════
// SmartProductCard — Zone A claymorphism card (PRD §8.1/§11.1)
// Tap the card → opens the FULL DETAIL PAGE (primary action).
// "🛒 Quick Buy" flips the card 180° to purchase options, with
// an always-visible "Open full page →" footer on the back so
// the detail page is reachable from every state. The card shows
// ONLY the primary cover image (no rotator, no hidden slide
// downloads — the full gallery lives on the detail page), ±7°
// pointer tilt, 3D book styling for book-type products. The flip
// itself is a compositor-driven CSS 3D transition (.flip-panel)
// so the slow-motion rotation shows identically on every mobile
// AND desktop browser, regardless of OS animation settings; the
// pointer tilt still respects reduced-motion.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Product, RatingSummary } from '@/types/marketplace'
import { categoriesForZone } from '@/types/marketplace'
import { useVisitorCurrency, visitorPriceLabel } from '@/lib/visitor-currency'
import { VisitorPrice } from '@/components/shop/VisitorPrice'
import { useAppStore } from '@/store/app-store'
import { playFx } from '@/lib/sound-fx'
import { cn } from '@/lib/utils'
import { productMediaImages, imgFallbackToHq } from '@/lib/video-thumb'
import { listThumbUrl } from '@/lib/image-url'
import { CheckoutButtons } from '@/components/checkout/CheckoutButtons'
import { ShareProductButton } from '@/components/shop/ShareProductButton'

const BOOK_CATEGORIES = ['coloring-books', 'story-ebooks', 'abcd-number-tracing']
const FALLBACK_IMG = '/images/products/kids-hero.png'

function badgeEmoji(badge: string) {
  const b = badge.toLowerCase()
  if (b.includes('hot')) return '🔥'
  if (b.includes('new')) return '🌱'
  if (b.includes('best')) return '🏆'
  return '✨'
}

export function SmartProductCard({
  product,
  priority = false,
  rating = null,
  openHref,
}: {
  product: Product
  priority?: boolean
  /** Layer 2 — verified-purchase summary; cards without reviews render exactly as before. */
  rating?: RatingSummary | null
  /** Real-route mode: the front face renders as a real <a href> (crawlable
   *  product link). Click/keyboard behaviour stays identical — the handler
   *  still routes through the SPA store. Undefined keeps the exact legacy DOM. */
  openHref?: string
}) {
  const navigate = useAppStore((s) => s.navigate)
  const [flipped, setFlipped] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const tiltRef = useRef<HTMLDivElement | null>(null)
  const navigationStartedRef = useRef(false)

  // T-V: the video's own YouTube frame LEADS the media list — a video
  // product shows its real thumbnail on the card, never the default
  // hero photo (which is only for products with neither images nor video).
  // Bandwidth rule: the card renders ONLY this primary cover — no
  // secondary slide is ever in the DOM, preloaded or downloaded.
  const mediaImages = productMediaImages(product)
  const cover = (mediaImages.length > 0 ? mediaImages : [FALLBACK_IMG])[0]

  // Visitor-currency price label (aria) — single currency, never both.
  const currency = useVisitorCurrency()
  const priceLabel = visitorPriceLabel(currency, product.priceUsd, product.priceInr)
  const catMeta = categoriesForZone(product.zone).find((c) => c.slug === product.category)

  // Progressive scroll reveal
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('revealed')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('revealed')
            io.unobserve(en.target)
          }
        })
      },
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Track reduced-motion preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const flipTo = (v: boolean) => {
    if (v === flipped) return
    playFx(v ? 'pop' : 'flip')
    setFlipped(v)
  }

  const openDetail = () => {
    if (navigationStartedRef.current) return
    navigationStartedRef.current = true
    // Use the mounted Next-router adapter on real routes (and the hash
    // router on the SPA). A full document reload made Kids card taps appear
    // unresponsive while the entire storefront booted again.
    playFx('whoosh')
    navigate('product', { productSlug: product.slug })
  }

  const handleTilt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current
    if (!el || reducedMotion) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`
  }

  const resetTilt = () => {
    if (tiltRef.current) tiltRef.current.style.transform = 'rotateX(0deg) rotateY(0deg)'
  }

  const frontKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openDetail()
    }
  }

  // One children tree, two possible roots: the real-route <a> (crawlable
  // href; a normal click still routes through the SPA store) or the exact
  // legacy div[role=button] when no openHref is given.
  const frontBody = (
    <>
      {/* Cover image area — the primary cover only. Every gallery
          image (and the slide browsing UI) lives on the detail page. */}
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          BOOK_CATEGORIES.includes(product.category) && 'book-spine book-pages',
        )}
      >
        <img
          src={listThumbUrl(cover)}
          alt={`${product.title} — product cover`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={imgFallbackToHq}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {product.badge && (
          <span className="brutal-sticker absolute left-2 top-2 z-10 bg-[#FFB347] px-2.5 py-1 text-xs font-extrabold text-[#4a2800]">
            {badgeEmoji(product.badge)} {product.badge}
          </span>
        )}

        {/* Share this product — pill matching the slide arrows, top-right
            (badge owns the top-left corner) */}
        <ShareProductButton
          product={product}
          aria-label={`Share ${product.title}`}
          className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-all hover:bg-black/60 active:scale-90"
        />
      </div>

      {/* Info block */}
      <div className="flex flex-none flex-col gap-1.5 p-4">
        <p className="font-baloo text-[11px] font-bold text-[#7a4a00]">by {product.authorBrand}</p>
        <h3 className="font-baloo toon-text line-clamp-2 text-lg font-bold leading-snug text-[#4a3b2a]">
          {product.title}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-[#FFB347]/60 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-[#8a5a20]">
            {catMeta ? `${catMeta.emoji} ${catMeta.label}` : product.category}
          </span>
          {product.ageOrLevel && (
            <span className="rounded-full border border-[#FFB347]/40 bg-[#FFF2CC] px-2 py-0.5 text-[10px] font-bold text-[#8a5a20]">
              {product.ageOrLevel}
            </span>
          )}
          {rating && rating.count > 0 && rating.avg !== null && (
            <span
              className="rounded-full border border-[#FFB347]/40 bg-[#FFF2CC] px-2 py-0.5 text-[10px] font-bold text-[#8a5a20]"
              aria-label={`Rated ${rating.avg} out of 5 by ${rating.count} verified buyers`}
            >
              ⭐ {rating.avg.toFixed(1)} ({rating.count})
            </span>
          )}
        </div>

        {/* Price, then a full-width Quick Buy — never clipped on
            narrow 2-column mobile cards */}
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <VisitorPrice
              usd={product.priceUsd}
              inr={product.priceInr}
              inrClassName="text-lg font-extrabold text-[#E67300]"
              usdClassName="text-xs font-semibold text-[#7d6440]"
            />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              flipTo(true)
            }}
            aria-label={`Quick buy options for ${product.title}`}
            className="flex min-h-[40px] w-full items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#FFB347] to-[#FF8A3D] px-3 text-xs font-extrabold text-[#4a2800] shadow-[0_4px_14px_rgba(255,136,0,0.4)] transition-transform hover:scale-[1.03] active:scale-95"
          >
            🛒 Quick Buy
          </button>
          <p className="text-center text-[10px] font-semibold text-[#7d6440]">Tap card for full details →</p>
        </div>
      </div>
    </>
  )

  const frontFace = openHref ? (
    <a
      href={openHref}
      onClick={(e) => {
        // Preserve open-in-new-tab / modified clicks; route ordinary clicks
        // through the app router so the shell and catalog are not reloaded.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        openDetail()
      }}
      inert={flipped || undefined}
      aria-label={`${product.title} — open details${priceLabel ? `, price ${priceLabel}` : ''}`}
      className="clay-card flip-face relative flex h-full cursor-pointer flex-col overflow-hidden"
    >
      {frontBody}
    </a>
  ) : (
    <div
      onClick={openDetail}
      onKeyDown={frontKeyDown}
      role="button"
      tabIndex={flipped ? -1 : 0}
      inert={flipped || undefined}
      aria-label={`${product.title} — open details${priceLabel ? `, price ${priceLabel}` : ''}`}
      className="clay-card flip-face relative flex h-full cursor-pointer flex-col overflow-hidden"
    >
      {frontBody}
    </div>
  )

  const backFace = (
    <div
      className="paper-grain flip-face flip-face-back absolute inset-0 flex flex-col overflow-hidden rounded-[24px] bg-gradient-to-br from-[#FFF2CC] to-[#FCE5CD]"
      style={{ pointerEvents: flipped ? 'auto' : 'none' }}
      inert={!flipped || undefined}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          flipTo(false)
        }}
        aria-label="Close quick buy and flip back"
        className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full border-2 border-black bg-white shadow-[3px_3px_0_#000] transition-transform hover:scale-110"
      >
        <X className="size-4 text-black" aria-hidden="true" />
      </button>

      <h3 className="font-baloo toon-text shrink-0 py-4 pl-5 pr-14 text-lg font-extrabold text-[#4a3b2a]">
        What&apos;s inside ✨
      </h3>

      {/* Scrollable middle */}
      <div className="nice-scroll mt-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-2">
        <ul className="space-y-1.5">
          {product.whatsInside.slice(0, 4).map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-xs font-medium leading-snug text-[#5b4a33]">
              <span aria-hidden="true" className="mt-0.5">🌟</span>
              <span>{item}</span>
            </li>
          ))}
          {product.whatsInside.length === 0 && (
            <li className="text-xs font-medium text-[#5b4a33]">A delightful surprise pack of printable joy!</li>
          )}
        </ul>

        <div className="flex flex-wrap gap-1.5">
          {(product.fileFormats.length > 0 ? product.fileFormats : ['Digital']).map((f) => (
            <span
              key={f}
              className="rounded-md border border-black/15 bg-white/80 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#4a3b2a]"
            >
              {f}
            </span>
          ))}
        </div>

        <p className="text-[11px] font-semibold text-[#8a5a20]">
          📜 Licence:{' '}
          {product.license === 'personal'
            ? 'Personal use'
            : product.license === 'commercial'
              ? 'Commercial use'
              : 'Extended commercial'}{' '}
          · instant delivery
        </p>

        <div className="flex items-baseline gap-2">
          <VisitorPrice
            usd={product.priceUsd}
            inr={product.priceInr}
            inrClassName="text-lg font-extrabold text-[#E67300]"
            usdClassName="text-xs font-semibold text-[#7d6440]"
          />
        </div>

        <CheckoutButtons product={product} compact />
      </div>

      {/* ALWAYS-visible footer — the detail page is one tap away */}
      <div className="shrink-0 border-t-2 border-dashed border-[#E67300]/35 bg-white/55 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openDetail()
          }}
          className="flex min-h-[40px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-2 border-[#E67300]/60 bg-white/85 px-3 text-xs font-extrabold text-[#B25E00] shadow-[0_3px_10px_rgba(255,136,0,0.18)] transition-colors hover:bg-[#FFB347]/25"
        >
          Open full page →
        </button>
      </div>
    </div>
  )

  return (
    <motion.div
      layoutId={`card-${product.id}`}
      ref={rootRef}
      className="tilt-wrap reveal min-h-[440px] h-full"
      onMouseMove={handleTilt}
      onMouseLeave={resetTilt}
    >
      <div ref={tiltRef} className="tilt-inner h-full">
        <div className={cn('flip-panel', flipped && 'is-flipped')}>
          {frontFace}
          {backFace}
        </div>
      </div>
    </motion.div>
  )
}
