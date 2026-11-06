'use client'

// ═══════════════════════════════════════════════════════════
// CheckoutButtons — renders ONLY what the product has
// configured (PRD §10.1): instant UPI download, India checkout
// link, international USD link and per-platform marketplace
// buttons. Order is geo-aware (GET /api/geo, cached once per
// session) but every configured button ALWAYS renders.
//
// `primaryOnly` renders a single hero CTA (⚡ instant → India
// → Global → first platform). Used by the slim mobile sticky
// buy bar so it can never stack up and cover the page.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import confetti from 'canvas-confetti'
import { useAppStore } from '@/store/app-store'
import type { Product } from '@/types/marketplace'
import { formatMoney } from '@/types/marketplace'
import { platformMeta } from '@/lib/platforms'
import { playFx } from '@/lib/sound-fx'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { track } from '@/lib/track'
import { InstantDownloadDialog } from '@/components/checkout/InstantDownloadDialog'

// ── Geo cache: one /api/geo fetch per browser session ──────
let geoCache: boolean | null = null
let geoInflight: Promise<boolean> | null = null

export function getGeo(): Promise<boolean> {
  if (geoCache !== null) return Promise.resolve(geoCache)
  // Reuse the shell's value if it already resolved geo this session
  const stored = useAppStore.getState().isIndia
  if (stored !== null) {
    geoCache = stored
    return Promise.resolve(stored)
  }
  if (!geoInflight) {
    geoInflight = fetch('/api/geo')
      .then((r) => (r.ok ? r.json() : { isIndia: true }))
      .then((d: { isIndia?: boolean }) => {
        geoCache = d.isIndia ?? true
        useAppStore.getState().setIsIndia(geoCache)
        return geoCache
      })
      .catch(() => {
        geoCache = true // primary audience — assume India on failure
        return geoCache
      })
  }
  return geoInflight
}

// meta.color classes are tuned for dark backgrounds; map a
// readable text tone for the light Kids Zone.
const PLATFORM_LIGHT_TEXT: Record<string, string> = {
  'amazon-kdp': 'text-amber-800',
  'notion-press': 'text-orange-800',
  gumroad: 'text-pink-700',
  etsy: 'text-rose-700',
  payhip: 'text-violet-700',
  pothi: 'text-lime-800',
  flipkart: 'text-yellow-800',
  'google-play-books': 'text-emerald-700',
  custom: 'text-teal-700',
}

function platformButtonClasses(id: string, zone: Product['zone']): string {
  const meta = platformMeta(id)
  const parts = meta.color.split(' ')
  const nonText = parts.filter((c) => !c.startsWith('text-')).join(' ')
  const text = parts.find((c) => c.startsWith('text-')) ?? 'text-foreground'
  return cn(nonText, zone === 'kids' ? (PLATFORM_LIGHT_TEXT[id] ?? 'text-foreground') : text)
}

export function CheckoutButtons({
  product,
  compact = false,
  primaryOnly = false,
}: {
  product: Product
  compact?: boolean
  primaryOnly?: boolean
}) {
  const { toast } = useToast()
  const [isIndia, setIsIndia] = useState<boolean | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let live = true
    void getGeo().then((v) => {
      if (live) setIsIndia(v)
    })
    return () => {
      live = false
    }
  }, [])

  const money = formatMoney(product.priceUsd, product.priceInr)
  const indiaPrimary = isIndia !== false // India-first while geo is unknown

  /** Confetti burst at the click point, then open link / demo toast */
  const openExternal = (
    e: ReactMouseEvent<HTMLButtonElement>,
    link: string,
    colors: string[],
    key: string,
    opts?: { particles?: number; spread?: number; sparkle?: boolean },
  ) => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1
    const h = typeof window !== 'undefined' ? window.innerHeight : 1
    let x = e.clientX / w
    let y = e.clientY / h
    if (!e.clientX && !e.clientY) {
      // keyboard activation — burst from the button centre instead
      const r = e.currentTarget.getBoundingClientRect()
      x = (r.left + r.width / 2) / w
      y = (r.top + r.height / 2) / h
    }
    confetti({
      particleCount: opts?.particles ?? 70,
      spread: opts?.spread ?? 70,
      origin: { x, y },
      colors,
      disableForReducedMotion: true,
    })
    playFx(opts?.sparkle ? 'sparkle' : 'chime')
    // Analytics beacon — fire-and-forget, never affects the click (PRD §11 funnel)
    track('platform_click', {
      productId: product.id,
      zone: product.zone,
      platform: key.startsWith('pl-') ? key.slice(3) : key,
      meta: { url: link === '#demo-checkout' ? null : link },
    })
    setPending(key)
    window.setTimeout(() => {
      if (link === '#demo-checkout') {
        toast({
          title: '🧪 Demo checkout',
          description: 'Demo mode: add real links in Admin to take live payments.',
        })
      } else {
        window.open(link, '_blank', 'noopener,noreferrer')
      }
      setPending(null)
    }, 260)
  }

  // Overflow-safe base: horizontal padding + centred wrapping text
  // so long labels can never spill outside the border.
  const btnBase =
    'relative flex w-full flex-col items-center justify-center overflow-hidden rounded-xl px-4 py-2 text-center font-bold transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-60'

  const mainSize = compact || primaryOnly ? 'min-h-[44px]' : 'min-h-[56px]'
  const platformSize = compact ? 'min-h-[42px]' : 'min-h-[44px]'
  const labelSize = compact || primaryOnly ? 'text-sm leading-snug' : 'text-sm leading-snug md:text-base'
  const subSize = compact ? 'text-[10px] leading-tight' : 'text-[11px] leading-tight md:text-xs'

  // ── primaryOnly: single slim CTA for the mobile sticky bar ─
  if (primaryOnly) {
    const platformFallback = product.platformLinks[0]
    return (
      <div className="w-full">
        {product.instantDownload ? (
          <button
            type="button"
            onClick={() => {
              playFx('chime')
              track('buy_click', { productId: product.id, zone: product.zone, platform: 'instant' })
              setDialogOpen(true)
            }}
            aria-label={`Instant Download for ${money.inr} — ${product.title}`}
            className={cn(
              btnBase,
              'min-h-[48px] flex-row justify-center gap-2 bg-gradient-to-r from-emerald-500 via-emerald-400 to-amber-400 text-base text-white shadow-[0_10px_30px_rgba(16,185,129,0.4)]',
            )}
          >
            <span className="relative z-10 truncate">⚡ Instant Download</span>
          </button>
        ) : product.indiaLink ? (
          <button
            type="button"
            disabled={pending === 'india'}
            aria-label={`Instant Indian Checkout via UPI for ${money.inr} — ${product.title}`}
            onClick={(e) =>
              openExternal(e, product.indiaLink as string, ['#FF9933', '#FFFFFF', '#138808', '#00F0FF'], 'india')
            }
            className={cn(
              btnBase,
              'min-h-[48px] flex-row justify-center gap-2 text-base',
              indiaPrimary
                ? 'border-2 border-[#E67300]/50 bg-gradient-to-r from-[#FF9933] via-[#FFB347] to-[#FFC97A] text-[#4a2800] shadow-[0_10px_28px_rgba(255,153,51,0.45)]'
                : 'border-2 border-[#FF9933]/70 bg-[#FF9933]/10 text-foreground hover:bg-[#FF9933]/20',
            )}
          >
            <span className="relative z-10 truncate">🇮🇳 Instant Checkout (UPI)</span>
          </button>
        ) : product.internationalLink ? (
          <button
            type="button"
            disabled={pending === 'intl'}
            aria-label={`Global purchase in USD for ${money.usd} — ${product.title}`}
            onClick={(e) =>
              openExternal(e, product.internationalLink as string, ['#E5B842', '#00F0FF', '#FAE8A7'], 'intl')
            }
            className={cn(
              btnBase,
              'min-h-[48px] flex-row justify-center gap-2 text-base',
              !indiaPrimary
                ? 'border-2 border-[#00F0FF]/50 bg-gradient-to-r from-[#00F0FF] to-[#00F5A0] text-[#001318] shadow-[0_10px_28px_rgba(0,240,255,0.35)]'
                : 'border-2 border-[#00F0FF]/60 bg-[#00F0FF]/10 text-foreground hover:bg-[#00F0FF]/20',
            )}
          >
            <span className="relative z-10 truncate">🌍 Global Purchase (USD)</span>
          </button>
        ) : platformFallback ? (
          <button
            type="button"
            aria-label={`${platformMeta(platformFallback.platform).label} — opens in a new tab`}
            onClick={(e) =>
              openExternal(
                e,
                platformFallback.url,
                ['#E5B842', '#00F0FF', '#FAE8A7'],
                `pl-${platformFallback.platform}`,
                { particles: 26, spread: 55, sparkle: true },
              )
            }
            className={cn(
              btnBase,
              'min-h-[48px] flex-row justify-center gap-2 border-2 text-sm',
              platformButtonClasses(platformFallback.platform, product.zone),
            )}
          >
            <span aria-hidden="true">{platformMeta(platformFallback.platform).emoji}</span>
            <span className="relative z-10 truncate">{platformMeta(platformFallback.platform).label}</span>
          </button>
        ) : null}

        {product.instantDownload && (
          <InstantDownloadDialog product={product} open={dialogOpen} onOpenChange={setDialogOpen} />
        )}
      </div>
    )
  }

  return (
    <div className={cn('w-full', compact ? 'flex flex-col gap-2' : 'flex flex-col gap-3')}>
      {(product.instantDownload || product.indiaLink || product.internationalLink) && (
        <div className={cn('flex gap-3', compact ? 'flex-col' : 'flex-col md:flex-row md:items-stretch')}>
          {product.instantDownload && (
            <button
              type="button"
              onClick={() => {
                playFx('chime')
                track('buy_click', { productId: product.id, zone: product.zone, platform: 'instant' })
                setDialogOpen(true)
              }}
              aria-label={`Instant Download for ${money.inr} — ${product.title}`}
              className={cn(
                btnBase,
                mainSize,
                'bg-gradient-to-r from-emerald-500 via-emerald-400 to-amber-400 text-white shadow-[0_10px_30px_rgba(16,185,129,0.4)]',
              )}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/30 to-transparent"
                style={{ animationDuration: '2.6s' }}
              />
              <span className="relative z-10 flex w-full flex-col items-center justify-center leading-tight">
                <span className={labelSize}>⚡ Instant Download · {money.inr}</span>
                <span className={cn('font-medium text-white/85', subSize)}>
                  GPay · PhonePe · Paytm · BHIM — emailed in seconds
                </span>
              </span>
            </button>
          )}

          {product.indiaLink && (
            <button
              type="button"
              disabled={pending === 'india'}
              aria-label={`Instant Indian Checkout via UPI for ${money.inr} — ${product.title}`}
              onClick={(e) =>
                openExternal(e, product.indiaLink as string, ['#FF9933', '#FFFFFF', '#138808', '#00F0FF'], 'india')
              }
              className={cn(
                btnBase,
                mainSize,
                indiaPrimary
                  ? 'border-2 border-[#E67300]/50 bg-gradient-to-r from-[#FF9933] via-[#FFB347] to-[#FFC97A] text-[#4a2800] shadow-[0_10px_28px_rgba(255,153,51,0.45)]'
                  : 'border-2 border-[#FF9933]/70 bg-[#FF9933]/10 text-foreground hover:bg-[#FF9933]/20',
              )}
            >
              <span className="flex w-full flex-col items-center justify-center leading-tight">
                <span className={labelSize}>🇮🇳 Instant Checkout (UPI) · {money.inr}</span>
                <span className={cn('font-medium opacity-80', subSize)}>GPay · PhonePe · Paytm · BHIM</span>
              </span>
            </button>
          )}

          {product.internationalLink && (
            <button
              type="button"
              disabled={pending === 'intl'}
              aria-label={`Global purchase in USD for ${money.usd} — ${product.title}`}
              onClick={(e) =>
                openExternal(e, product.internationalLink as string, ['#E5B842', '#00F0FF', '#FAE8A7'], 'intl')
              }
              className={cn(
                btnBase,
                mainSize,
                !indiaPrimary
                  ? 'border-2 border-[#00F0FF]/50 bg-gradient-to-r from-[#00F0FF] to-[#00F5A0] text-[#001318] shadow-[0_10px_28px_rgba(0,240,255,0.35)]'
                  : 'border-2 border-[#00F0FF]/60 bg-[#00F0FF]/10 text-foreground hover:bg-[#00F0FF]/20',
              )}
            >
              <span className="flex w-full flex-col items-center justify-center leading-tight">
                <span className={labelSize}>🌍 Global Purchase (USD) · {money.usd}</span>
                <span className={cn('font-medium opacity-80', subSize)}>Secure external checkout</span>
              </span>
            </button>
          )}
        </div>
      )}

      {product.platformLinks.length > 0 && (
        <div className={cn('flex gap-2', compact ? 'flex-col' : 'flex-row flex-wrap')}>
          {product.platformLinks.map((link, i) => {
            const meta = platformMeta(link.platform)
            return (
              <button
                key={`${link.platform}-${link.url}-${i}`}
                type="button"
                disabled={pending === `pl-${link.platform}`}
                aria-label={`${meta.label} — ${money.usd} / ${money.inr}, opens in a new tab`}
                onClick={(e) =>
                  openExternal(e, link.url, ['#E5B842', '#00F0FF', '#FAE8A7'], `pl-${link.platform}`, {
                    particles: 26,
                    spread: 55,
                    sparkle: true,
                  })
                }
                className={cn(
                  btnBase,
                  platformSize,
                  'min-h-[44px] flex-row justify-center gap-2 border-2 text-sm font-semibold hover:scale-[1.02] md:flex-1 md:min-w-[200px]',
                  platformButtonClasses(link.platform, product.zone),
                )}
              >
                <span aria-hidden="true" className="shrink-0 text-base leading-none">
                  {meta.emoji}
                </span>
                <span className="relative z-10 truncate">{meta.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {product.instantDownload && (
        <InstantDownloadDialog product={product} open={dialogOpen} onOpenChange={setDialogOpen} />
      )}
    </div>
  )
}
