'use client'

// ═══════════════════════════════════════════════════════════
// CreatorCard — Zone B cyberpunk bento card (PRD §8.2/§11.2).
// Video live-preview with visibility-aware playback (max 4
// concurrent on mobile), glitch-hover titles, mono-tag spec
// row and a mouse-tracked specular glare.
// "⚡ QUICK BUY" flips the card 180° to purchase options —
// same compositor-driven CSS 3D flip as the Kids cards
// (.flip-panel), so the slow-motion rotation shows identically
// on every mobile AND desktop browser. The back carries the
// spec sheet + checkout with an always-visible "OPEN FULL
// PAGE →" footer; the preview video pauses while the back is
// shown.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import type { Product, RatingSummary } from '@/types/marketplace'
import { platformMeta } from '@/lib/platforms'
import { playFx } from '@/lib/sound-fx'
import { youtubeThumbnailUrl, imgFallbackToHq } from '@/lib/video-thumb'
import { listThumbUrl } from '@/lib/image-url'
import { cn } from '@/lib/utils'
import { useVisitorCurrency, visitorPriceLabel } from '@/lib/visitor-currency'
import { VisitorPrice } from '@/components/shop/VisitorPrice'
import { CheckoutButtons } from '@/components/checkout/CheckoutButtons'
import { ShareProductButton } from '@/components/shop/ShareProductButton'

const FALLBACK_IMG = '/images/products/creator-hero.png'

// Module-level concurrency cap: at most 4 preview videos play
// simultaneously on mobile-width screens.
const playingVideos = new Set<HTMLVideoElement>()

function safePlay(v: HTMLVideoElement) {
  const mobile = typeof window !== 'undefined' && window.innerWidth < 768
  if (mobile && playingVideos.size >= 4 && !playingVideos.has(v)) return
  playingVideos.add(v)
  void v.play().catch(() => {
    /* autoplay guard */
  })
}

function safePause(v: HTMLVideoElement) {
  playingVideos.delete(v)
  v.pause()
}

export function CreatorCard({
  product,
  size = 'md',
  rating = null,
  openHref,
}: {
  product: Product
  size?: 'md' | 'lg'
  /** Layer 2 — verified-purchase summary; cards without reviews render exactly as before. */
  rating?: RatingSummary | null
  /** Real-route mode: the front face renders as a real <a href> (crawlable
   *  product link). Click/keyboard behaviour stays identical — the handler
   *  still routes through the SPA store. Undefined keeps the exact legacy DOM. */
  openHref?: string
}) {
  const navigate = useAppStore((s) => s.navigate)
  // Visitor-currency price (aria + tags) — single currency, never both.
  const currency = useVisitorCurrency()
  const priceLabel = visitorPriceLabel(currency, product.priceUsd, product.priceInr)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [flipped, setFlipped] = useState(false)
  /** True when the ambient YouTube embed can't play (embed-disabled
   *  video / live stream, blocked player…) — the card then falls back
   *  to the video's own thumbnail instead of a black error box. */
  const [ytEmbedFailed, setYtEmbedFailed] = useState(false)
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null)

  // Mirrors for use inside observer closures without re-subscribing
  const flippedRef = useRef(false)
  const visibleRef = useRef(false)

  // T-V Feature B: cards consume the SAFE video descriptor the public API
  // now sends (youtube video id / imagekit public path). Ambient preview
  // behaviour is byte-identical to before — only the data source changed.
  const isVideo = product.mediaType === 'video' && Boolean(product.videoPreview)
  const ytId = isVideo && product.videoPreview?.provider === 'youtube' ? product.videoPreview.videoId : null
  const ytThumb = youtubeThumbnailUrl(product.videoPreview)
  const fileVideoSrc =
    isVideo && (product.videoPreview?.provider === 'imagekit' || product.videoPreview?.provider === 'file')
      ? product.videoPreview.ref
      : null
  const cover = product.images[0] ?? FALLBACK_IMG

  // ── Dead-embed detection (IFrame Player API postMessage handshake) ──
  // The iframe content is cross-origin, so "is it playing?" can't be read
  // directly — but the player answers a `listening` handshake with
  // onReady/onStateChange messages, and reports onError (101/150 = embed
  // not allowed). Total silence means the player never booted. Either way
  // the iframe is removed and the video's own thumbnail remains visible.
  useEffect(() => {
    if (!ytId) return
    let alive = false
    let done = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const finish = (failed: boolean) => {
      if (done) return
      done = true
      if (failed) setYtEmbedFailed(true)
    }
    const onMsg = (e: MessageEvent) => {
      let host = ''
      try {
        host = new URL(e.origin).hostname
      } catch {
        return
      }
      if (host !== 'www.youtube.com' && host !== 'www.youtube-nocookie.com' && !host.endsWith('.youtube.com')) return
      const d = e.data as { event?: string } | null
      if (!d || typeof d !== 'object' || typeof d.event !== 'string') return
      if (d.event === 'onError') {
        finish(true)
      } else if (d.event === 'onReady' || d.event === 'onStateChange' || d.event === 'listening' || d.event === 'initialization') {
        alive = true
        finish(false)
      }
    }
    window.addEventListener('message', onMsg)
    const ping = () => {
      const w = ytIframeRef.current?.contentWindow
      if (w) w.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
    }
    ping()
    timers.push(setTimeout(ping, 1500), setTimeout(ping, 3500))
    timers.push(setTimeout(() => finish(!alive), 8000))
    return () => {
      window.removeEventListener('message', onMsg)
      for (const t of timers) clearTimeout(t)
    }
  }, [ytId])

  // Scroll reveal
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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Play preview video only while ≥40% visible (and not flipped)
  useEffect(() => {
    if (!isVideo) return
    const v = videoRef.current
    const holder = rootRef.current
    if (!v || !holder || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          visibleRef.current = en.isIntersecting
          if (en.isIntersecting && !flippedRef.current) safePlay(v)
          else safePause(v)
        })
      },
      { threshold: 0.4 },
    )
    io.observe(holder)
    return () => {
      io.disconnect()
      safePause(v)
    }
  }, [isVideo])

  // Pause the preview while the quick-buy back is shown; resume on flip-back
  useEffect(() => {
    flippedRef.current = flipped
    if (!isVideo) return
    const v = videoRef.current
    if (!v) return
    if (flipped) safePause(v)
    else if (visibleRef.current) safePlay(v)
  }, [flipped, isVideo])

  const navigationAttemptAtRef = useRef(0)

  const open = () => {
    // Suppress only an immediate double-click. A permanent latch can make
    // the card unusable if a client-side route transition is interrupted.
    if (Date.now() - navigationAttemptAtRef.current < 300) return
    navigationAttemptAtRef.current = Date.now()
    // Keep navigation inside Next on real routes and inside the hash router
    // on the SPA. Avoid a full document reload for every product-card tap.
    playFx('flip')
    navigate('product', { productSlug: product.slug })
  }

  const flipTo = (v: boolean) => {
    if (v === flipped) return
    playFx(v ? 'pop' : 'flip')
    setFlipped(v)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

  // Real-route mode: the front face renders as a real <a href> (crawlable
  // product link). Click/keyboard behaviour stays identical — a normal
  // click still routes through the SPA store. Undefined keeps the exact
  // legacy div[role=button] DOM.
  const FrontTag = (openHref ? 'a' : 'div') as 'a' | 'div'
  const frontTagProps = (
    openHref
      ? {
          href: openHref,
          onClick: (e: ReactMouseEvent<HTMLElement>) => {
            // Modified clicks retain the real href (new tab/window).
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            open()
          },
        }
      : { onClick: open, role: 'button' as const, tabIndex: flipped ? -1 : 0 }
  ) as React.ComponentPropsWithoutRef<'a'> & React.ComponentPropsWithoutRef<'div'>

  const handleGlare = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    el.style.setProperty('--glare-x', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
    el.style.setProperty('--glare-y', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
  }

  return (
    <div
      ref={rootRef}
      onMouseMove={handleGlare}
      className={cn('reveal relative h-full', size === 'lg' && 'sm:col-span-2')}
    >
      <div className="flip-scene h-full">
        <div className={cn('flip-panel', flipped && 'is-flipped')}>
          {/* FRONT — media + spec + quick buy (opens detail on tap) */}
          <FrontTag
            {...frontTagProps}
            inert={flipped || undefined}
            aria-label={`${product.title} — open details${priceLabel ? `, price ${priceLabel}` : ''}`}
            onKeyDown={!openHref ? onKeyDown : undefined}
            className="cyber-card flip-face group flex h-full cursor-pointer flex-col overflow-hidden"
          >
      {/* Media — ONE primary cover for image products (gallery lives
          on the detail page; no hidden slide downloads), video previews
          keep their own playback. */}
      <div className="relative aspect-video w-full overflow-hidden bg-black/50">
        {ytId ? (
          ytEmbedFailed ? (
            /* Embed can't play (embed-disabled video / blocked player) —
               the video's own thumbnail IS the card visual now. */
            <img
              src={ytThumb ?? undefined}
              alt={`${product.title} video thumbnail`}
              loading="lazy"
              onError={imgFallbackToHq}
              className={cn(
                'absolute inset-0 h-full w-full object-cover',
                !reducedMotion && 'transition-transform duration-500 group-hover:scale-105',
              )}
            />
          ) : (
            <>
              {/* The video's own frame shows while the embed loads —
                  strictly behind the iframe. */}
              <img
                src={ytThumb ?? undefined}
                alt=""
                aria-hidden="true"
                loading="lazy"
                onError={imgFallbackToHq}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <iframe
                ref={ytIframeRef}
                src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=1&loop=1&playlist=${ytId}&controls=0&modestbranding=1&playsinline=1&rel=0&enablejsapi=1`}
                title={`${product.title} video preview`}
                allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </>
          )
        ) : isVideo ? (
          <video
            ref={videoRef}
            src={fileVideoSrc ?? undefined}
            poster={cover}
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            preload="metadata"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          /* Image products: the primary cover only — the full gallery
             lives on the detail page, no hidden slide downloads. */
          <img
            src={listThumbUrl(cover)}
            alt={`${product.title} preview`}
            loading="lazy"
            decoding="async"
            onError={imgFallbackToHq}
            className={cn(
              'absolute inset-0 h-full w-full object-cover',
              !reducedMotion && 'transition-transform duration-500 group-hover:scale-105',
            )}
          />
        )}

        {isVideo && !ytEmbedFailed && (
          <span className="mono-tag absolute right-2 top-2 z-10">▶ LIVE PREVIEW</span>
        )}

        {product.featured && (
          <span className="absolute left-2 top-2 z-10 rounded-sm border border-[#C084FC]/60 bg-[#C084FC]/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[#C084FC]">
            FEATURED
          </span>
        )}

        {product.instantDownload && (
          <span className="absolute bottom-2 left-2 z-10 rounded-sm border border-[#00F5A0]/40 bg-[#00F5A0]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#00F5A0]">
            ⚡ INSTANT EMAIL DELIVERY
          </span>
        )}

        <div className="specular" aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3
          className="glitch-hover font-jetbrains text-base font-semibold leading-snug text-foreground lg:text-lg"
          data-text={product.title}
        >
          {product.title}
        </h3>

        <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>

        <div className="flex flex-wrap gap-1.5">
          <span className="mono-tag">FORMAT: {product.fileFormats.join('/') || 'DIGITAL'}</span>
          <span className="mono-tag">LICENSE: {product.license.toUpperCase()}</span>
          <span className="mono-tag">
            PRICE: <VisitorPrice usd={product.priceUsd} inr={product.priceInr} />
          </span>
          {rating && rating.count > 0 && rating.avg !== null && (
            <span
              className="mono-tag"
              aria-label={`Rated ${rating.avg} out of 5 by ${rating.count} verified buyers`}
            >
              ⭐ {rating.avg.toFixed(1)} ({rating.count})
            </span>
          )}
        </div>

        {product.platformLinks.length > 0 && (
          <div className="flex items-center gap-1.5 text-base" aria-label="Also available on">
            {product.platformLinks.map((link, i) => (
              <span
                key={`${link.platform}-${link.url}-${i}`}
                title={platformMeta(link.platform).short}
                aria-label={platformMeta(link.platform).short}
              >
                {platformMeta(link.platform).emoji}
              </span>
            ))}
          </div>
        )}

        {/* Quick buy — flips to the purchase side (same 3D flip as the Kids cards) */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            flipTo(true)
          }}
          aria-label={`Quick buy options for ${product.title}`}
          className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-sm border border-[#00F0FF]/50 bg-[#00F0FF]/10 px-3 font-jetbrains text-xs font-bold tracking-widest text-[#00F0FF] transition-all hover:bg-[#00F0FF]/20 hover:shadow-[0_0_16px_rgba(0,240,255,0.25)] active:scale-95"
        >
          ⚡ QUICK BUY
        </button>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex items-baseline gap-2">
            <VisitorPrice
              usd={product.priceUsd}
              inr={product.priceInr}
              inrClassName="font-jetbrains text-xl font-bold text-[#00F0FF]"
              usdClassName="font-mono text-xs text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-2">
            <ShareProductButton
              product={product}
              aria-label={`Share ${product.title}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-[#00F0FF]/50 text-[#00F0FF] transition-all hover:bg-[#00F0FF]/15 hover:shadow-[0_0_12px_rgba(0,240,255,0.25)] active:scale-90"
            />
            <span className="font-jetbrains text-[11px] font-bold tracking-widest text-[#00F0FF] transition-transform duration-200 group-hover:translate-x-1">
              VIEW DETAILS →
            </span>
          </div>
        </div>
      </div>
          </FrontTag>

          {/* BACK — spec sheet + checkout (same 3D flip as the Kids cards) */}
          <div
            className="flip-face flip-face-back absolute inset-0 flex flex-col overflow-hidden rounded-[4px] border border-[#00F0FF]/25 bg-[linear-gradient(160deg,rgba(14,16,18,0.94),rgba(8,10,12,0.97))] shadow-[0_0_28px_rgba(0,240,255,0.12)]"
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
              className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-sm border border-[#00F0FF]/50 bg-black/60 text-[#00F0FF] transition-all hover:bg-[#00F0FF]/20 hover:shadow-[0_0_14px_rgba(0,240,255,0.3)] active:scale-90"
            >
              <X className="size-4" aria-hidden="true" />
            </button>

            <h3 className="shrink-0 py-4 pl-5 pr-14 font-jetbrains text-base font-bold tracking-widest text-[#00F0FF]">
              INSIDE THE PACK ⚡
            </h3>

            {/* Scrollable middle */}
            <div className="nice-scroll mt-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-2">
              <ul className="space-y-1.5">
                {(product.whatsInside.length > 0
                  ? product.whatsInside.slice(0, 5)
                  : [
                      product.description.trim() ||
                        'A precision-crafted digital pack — open the full page for the complete spec.',
                    ]
                ).map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                    <span aria-hidden="true" className="mt-0.5 text-[#00F0FF]">
                      ⚡
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-1.5">
                {(product.fileFormats.length > 0 ? product.fileFormats : ['DIGITAL']).map((f) => (
                  <span key={f} className="mono-tag">
                    {f.toUpperCase()}
                  </span>
                ))}
              </div>

              <p className="font-mono text-[11px] font-semibold tracking-wide text-[#00F0FF]/80">
                LICENSE:{' '}
                {product.license === 'personal'
                  ? 'PERSONAL USE'
                  : product.license === 'commercial'
                    ? 'COMMERCIAL USE'
                    : 'EXTENDED COMMERCIAL'}{' '}
                · INSTANT DELIVERY
              </p>

              <div className="flex items-baseline gap-2">
                <VisitorPrice
                  usd={product.priceUsd}
                  inr={product.priceInr}
                  inrClassName="font-jetbrains text-xl font-bold text-[#00F0FF]"
                  usdClassName="font-mono text-xs text-muted-foreground"
                />
              </div>

              <CheckoutButtons product={product} compact />
            </div>

            {/* ALWAYS-visible footer — the detail page is one tap away */}
            <div className="shrink-0 border-t border-[#00F0FF]/20 bg-black/40 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  open()
                }}
                className="flex min-h-[40px] w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-[#00F0FF]/60 bg-[#00F0FF]/10 px-3 font-jetbrains text-[11px] font-bold tracking-widest text-[#00F0FF] transition-colors hover:bg-[#00F0FF]/20"
              >
                OPEN FULL PAGE →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
