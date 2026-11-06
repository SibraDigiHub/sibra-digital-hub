'use client'

// ═══════════════════════════════════════════════════════════
// SmartProductCard — Zone A claymorphism card (PRD §8.1/§11.1)
// Tap the card → opens the FULL DETAIL PAGE (primary action).
// "🛒 Quick Buy" flips the card 180° to purchase options, with
// an always-visible "Open full page →" footer on the back so
// the detail page is reachable from every state. 2000ms image
// rotator with glowing pagination dots, ±7° pointer tilt, 3D
// book styling for book-type products. The flip itself is a
// compositor-driven CSS 3D transition (.flip-panel) so the
// slow-motion rotation shows identically on every mobile AND
// desktop browser, regardless of OS animation settings; the
// pointer tilt still respects reduced-motion.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Product, RatingSummary } from '@/types/marketplace'
import { categoriesForZone, formatMoney } from '@/types/marketplace'
import { useAppStore } from '@/store/app-store'
import { playFx } from '@/lib/sound-fx'
import { cn } from '@/lib/utils'
import { useRotator } from '@/hooks/useRotator'
import { productMediaImages, imgFallbackToHq } from '@/lib/video-thumb'
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

  // T-V: the video's own YouTube frame LEADS the media list — a video
  // product shows its real thumbnail on the card, never the default
  // hero photo (which is only for products with neither images nor video).
  const mediaImages = productMediaImages(product)
  const images = mediaImages.length > 0 ? mediaImages : [FALLBACK_IMG]
  const total = images.length
  const {
    index: rotatorIndex,
    goTo,
    next,
    prev,
    setPaused,
    ref: rotatorRef,
  } = useRotator(images, { enabled: !flipped })

  // Hover/stay pauses the 2.5s auto-rotation; leaving resumes it.
  // Touch swipe (and the ‹ › arrows) gives manual slide control.
  const touchX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchX.current
    touchX.current = null
    if (start == null || total <= 1) return
    const dx = (e.changedTouches[0]?.clientX ?? start) - start
    if (Math.abs(dx) < 36) return
    playFx('pop')
    if (dx < 0) next()
    else prev()
  }
  const money = formatMoney(product.priceUsd, product.priceInr)
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
    playFx('whoosh')
    navigate('product', { productSlug: product.slug })
  }

  const handleTilt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current
    if (!el || reducedMotion) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `rotateX(${(-py * 14).toFixed(2)}deg) rotateY(${(px * 14).toFixed(2)}deg)`
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
      {/* Rotating image area — auto-advances every 2.5s,
          pauses while the visitor hovers/stays, resumes on leave */}
      <div
        ref={rotatorRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          BOOK_CATEGORIES.includes(product.category) && 'book-spine book-pages',
        )}
      >
        {images.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt={`${product.title} — preview ${i + 1} of ${total}`}
            loading={priority && i === 0 ? 'eager' : 'lazy'}
            onError={imgFallbackToHq}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
              i === rotatorIndex ? 'opacity-100' : 'opacity-0',
            )}
          />
        ))}

        {total > 1 && (
          <>
            {/* manual slide arrows */}
            <button
              type="button"
              aria-label="Previous image"
              onClick={(e) => {
                e.stopPropagation()
                playFx('pop')
                prev()
              }}
              className="absolute left-1.5 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-all hover:bg-black/60 active:scale-90"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={(e) => {
                e.stopPropagation()
                playFx('pop')
                next()
              }}
              className="absolute right-1.5 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-all hover:bg-black/60 active:scale-90"
            >
              ›
            </button>
            <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
              {images.map((src, i) => (
                <button
                  key={`dot-${i}`}
                  type="button"
                  aria-label={`Show image ${i + 1} of ${total}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    playFx('pop')
                    goTo(i)
                  }}
                  className={cn(
                    'size-2.5 rounded-full transition-all duration-300',
                    i === rotatorIndex
                      ? 'scale-125 bg-white shadow-[0_0_8px_rgba(255,179,71,0.95)]'
                      : 'bg-white/55 hover:bg-white/85',
                  )}
                />
              ))}
            </div>
          </>
        )}

        <span className="absolute bottom-2 right-2 z-10 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white">
          Page {rotatorIndex + 1} of {total}
        </span>

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
            <span className="text-lg font-extrabold text-[#E67300]">{money.inr}</span>
            <span className="text-xs font-semibold text-[#7d6440]">{money.usd}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
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
        e.preventDefault()
        openDetail()
      }}
      onKeyDown={frontKeyDown}
      inert={flipped || undefined}
      aria-label={`${product.title} — open details, price ${money.inr}`}
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
      aria-label={`${product.title} — open details, price ${money.inr}`}
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
          <span className="text-lg font-extrabold text-[#E67300]">{money.inr}</span>
          <span className="text-xs font-semibold text-[#7d6440]">{money.usd}</span>
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
