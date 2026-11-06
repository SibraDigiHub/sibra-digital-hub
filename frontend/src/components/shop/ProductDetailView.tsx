'use client'

// ═══════════════════════════════════════════════════════════
// ProductDetailView — product page (PRD §8.3). Sticky media
// gallery, geo-aware checkout, tabbed details, related rail,
// JSON-LD product schema and a sticky mobile buy bar.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ChevronRight,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react'
import { parseProduct, useAppStore } from '@/store/app-store'
import type { License, Product, ProductRow, Zone } from '@/types/marketplace'
import { formatMoney } from '@/types/marketplace'
import { siteUrl } from '@/lib/site-url'
import { realCategoryPath, realProductPath, realShopPath } from '@/lib/real-routes'
import { hydrateCategories, useZoneCategories } from '@/lib/categories'
import { playFx } from '@/lib/sound-fx'
import VideoPlayerFrame from '@/components/shop/VideoPlayerFrame'
import { ProductReviews } from '@/components/shop/ProductReviews'
import { productMediaImages, imgFallbackToHq } from '@/lib/video-thumb'
import { jsonLdString } from '@/lib/json-ld'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CheckoutButtons } from '@/components/checkout/CheckoutButtons'
import { SmartProductCard } from '@/components/shop/SmartProductCard'
import { CreatorCard } from '@/components/shop/CreatorCard'
import { ShareProductButton } from '@/components/shop/ShareProductButton'

const LICENSE_COPY: Record<License, string> = {
  personal:
    'Personal use licence — print and enjoy at home, in your classroom or at family events. You may not resell, redistribute or share the files themselves. Perfect for parents, teachers and caretakers.',
  commercial:
    'Commercial licence — use these assets in client work, monetised channels and products for sale (up to 500 end products). Attribution is appreciated but not required. Teams larger than 5 seats need an extended licence.',
  extended:
    'Extended licence — unlimited commercial projects, agency use and white-label resale of derivative work. The source files cannot be resold as-is or repackaged as a competing template.',
}

export interface DetailState {
  slug: string
  product: Product | null
  related: Product[]
  notFound: boolean
  error: boolean
}

function DetailSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-3">
        <Skeleton className="aspect-[4/3] w-full rounded-[24px]" />
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="size-16 rounded-xl" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    </div>
  )
}

export function ProductDetailView({
  slug,
  initial,
  realLinks = false,
}: {
  slug: string
  /** Server-fetched seed for the real /product/[slug] route: the first
   *  HTML then already carries title, price, description and what's-inside.
   *  The hash SPA view never passes it — behaviour there is unchanged. */
  initial?: DetailState
  /** Real-route mode: breadcrumb renders as real <a href> links (crawlable)
   *  instead of the hash-SPA buttons. Visual output is identical. */
  realLinks?: boolean
}) {
  const navigate = useAppStore((s) => s.navigate)
  const storeZone = useAppStore((s) => s.zone)

  const [data, setData] = useState<DetailState>(
    initial ?? {
      slug,
      product: null,
      related: [],
      notFound: false,
      error: false,
    },
  )
  const [reload, setReload] = useState(0)
  const [activeImg, setActiveImg] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)

  const tiltRef = useRef<HTMLDivElement | null>(null)

  // T10: live categories — breadcrumb label reflects admin-managed registry
  const zoneCats = useZoneCategories(data.product?.zone ?? storeZone ?? 'kids')
  const categoryLabelText = data.product ? zoneCats.find((c) => c.slug === data.product?.category)?.label : undefined

  // T10: shared single fetch for the category registry
  useEffect(() => {
    void hydrateCategories()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const ac = new AbortController()

    fetch(`/api/products?slug=${encodeURIComponent(slug)}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error('failed')
        return r.json() as Promise<{ products: ProductRow[] }>
      })
      .then((d) => {
        if (d.products.length === 0) {
          setData({ slug, product: null, related: [], notFound: true, error: false })
          return undefined
        }
        const p = parseProduct(d.products[0] as unknown as Record<string, unknown>) as unknown as Product
        setActiveImg(0)
        setData({ slug, product: p, related: [], notFound: false, error: false })
        return fetch(`/api/products?zone=${p.zone}&limit=8`, { signal: ac.signal })
          .then((r) => (r.ok ? (r.json() as Promise<{ products: ProductRow[] }>) : { products: [] }))
          .then((rd) => {
            setData((prev) =>
              prev.slug === slug
                ? {
                    ...prev,
                    related: rd.products
                      .filter((row) => row.slug !== p.slug)
                      .slice(0, 4)
                      .map((row) => parseProduct(row as unknown as Record<string, unknown>) as unknown as Product),
                  }
                : prev,
            )
          })
          .catch(() => {
            /* related rail is optional */
          })
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return
        setData({ slug, product: null, related: [], notFound: false, error: true })
      })

    return () => ac.abort()
  }, [slug, reload])

  const loading = data.slug !== slug || (!data.product && !data.notFound && !data.error)

  // Theme the shell to the PRODUCT's zone (direct links from the
  // other zone otherwise keep the stale store zone applied).
  useEffect(() => {
    if (data.product && useAppStore.getState().zone !== data.product.zone) {
      useAppStore.getState().setZone(data.product.zone)
    }
  }, [data.product])

  const handleTilt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current
    if (!el || reducedMotion) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`
  }

  const resetTilt = () => {
    if (tiltRef.current) tiltRef.current.style.transform = 'rotateX(0deg) rotateY(0deg)'
  }

  const backToShop = (zone: Zone) => {
    playFx('whoosh')
    navigate('shop', { zone, category: null })
  }

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6">
        <DetailSkeleton />
      </div>
    )
  }

  // ── Error / 404 ───────────────────────────────────────────
  if (data.error) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="text-6xl" aria-hidden="true">
          📡
        </span>
        <h1 className="text-2xl font-bold">The shelf wobbled — this page didn&apos;t load.</h1>
        <p className="text-muted-foreground">A network glitch interrupted the treasure hunt. Try again?</p>
        <Button onClick={() => setReload((n) => n + 1)} className="h-11 min-w-[160px]">
          <RotateCcw className="size-4" aria-hidden="true" /> Retry
        </Button>
      </div>
    )
  }

  if (data.notFound || !data.product) {
    const fallbackZone: Zone = storeZone ?? 'kids'
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="text-7xl" aria-hidden="true">
          🦖
        </span>
        <h1 className="text-2xl font-bold md:text-3xl">Roar! This page wandered off.</h1>
        <p className="text-muted-foreground">
          The treasure you seek isn&apos;t on this shelf — maybe it moved to another aisle.
        </p>
        <Button onClick={() => backToShop(fallbackZone)} className="h-11 min-w-[180px]">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the shop
        </Button>
      </div>
    )
  }

  const product = data.product
  const related = data.related

  const isKids = product.zone === 'kids'
  // T-V: the video's own YouTube frame leads the media list — video/watch
  // products show their real thumbnail here (and as the click-to-play
  // poster), never the default hero photo.
  const mediaImages = productMediaImages(product)
  const images = mediaImages.length > 0 ? mediaImages : ['/images/products/kids-hero.png']
  const money = formatMoney(product.priceUsd, product.priceInr)
  // T-V Feature B: the video renders via the click-to-play frame — the
  // source arrives from the server only after Play (raw URL never in page).
  const videoPreview = product.videoPreview ?? null
  const isVideo = product.mediaType === 'video' && Boolean(videoPreview)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    // Media list — leads with the video's own frame for video products.
    image: images,
    description: product.description,
    sku: product.slug,
    brand: { '@type': 'Brand', name: product.authorBrand },
    category: product.category,
    url: `${siteUrl()}${realProductPath(product.slug)}`,
    offers: (
      [
        { price: product.priceInr, priceCurrency: 'INR' },
        { price: product.priceUsd, priceCurrency: 'USD' },
      ] as const
    )
      .filter((o) => o.price > 0)
      .map((o) => ({
        '@type': 'Offer',
        price: o.price,
        priceCurrency: o.priceCurrency,
        availability: 'https://schema.org/InStock',
        url: `${siteUrl()}${realProductPath(product.slug)}`,
      })),
    // Only specs that actually exist in the product data — never invented.
    additionalProperty: (
      [
        product.ageOrLevel ? { name: 'Age or level', value: product.ageOrLevel } : null,
        product.pageCount !== null ? { name: 'Page count', value: String(product.pageCount) } : null,
        product.fileFormats.length > 0 ? { name: 'Formats', value: product.fileFormats.join(', ') } : null,
        { name: 'Licence', value: product.license },
      ] as ({ name: string; value: string } | null)[]
    ).filter((v): v is { name: string; value: string } => v !== null),
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-2 md:px-6 lg:pb-12">
      {/* T7 §8.5: `<` escaped as \u003c — product fields are admin-authored
          and must never be able to break out of the JSON-LD script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />

      {/* Back + breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => backToShop(product.zone)}
          aria-label="Back to shop"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 transition-transform hover:scale-105"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
          {realLinks ? (
            <a
              href={realShopPath(product.zone)}
              onClick={(e) => {
                e.preventDefault()
                backToShop(product.zone)
              }}
              className="font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Shop
            </a>
          ) : (
            <button
              type="button"
              onClick={() => backToShop(product.zone)}
              className="font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Shop
            </button>
          )}
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {realLinks ? (
            <a
              href={realCategoryPath(product.zone, product.category)}
              onClick={(e) => {
                e.preventDefault()
                playFx('pop')
                navigate('shop', { zone: product.zone, category: product.category })
              }}
              className="font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {categoryLabelText ?? data.product.category}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                playFx('pop')
                navigate('shop', { zone: product.zone, category: product.category })
              }}
              className="font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {categoryLabelText ?? data.product.category}
            </button>
          )}
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-muted-foreground">{product.title}</span>
        </nav>

        {/* Share this product — mirrors the back button's circle on the right */}
        <ShareProductButton
          product={product}
          aria-label={`Share ${product.title}`}
          className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-foreground transition-transform hover:scale-105"
        />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* ── LEFT: sticky premium media ── */}
        <div className="self-start lg:sticky lg:top-24">
          {/* ambient glow behind the frame */}
          <div aria-hidden="true" className="relative">
            <div
              className={cn(
                'absolute -inset-3 rounded-[32px] opacity-60 blur-2xl',
                isKids
                  ? 'bg-[radial-gradient(closest-side,rgba(255,179,71,0.35),transparent)]'
                  : 'bg-[radial-gradient(closest-side,rgba(0,240,255,0.22),transparent)]',
              )}
            />
            <div className="tilt-wrap relative">
              <div
                className={cn(
                  'rounded-[28px] p-[2px] shadow-[0_24px_60px_rgba(0,0,0,0.18)]',
                  isKids
                    ? 'bg-[linear-gradient(135deg,rgba(255,179,71,0.9),rgba(255,246,223,0.55),rgba(255,138,61,0.8))]' 
                    : 'bg-[linear-gradient(135deg,rgba(0,240,255,0.75),rgba(13,13,13,0.2),rgba(0,245,160,0.55))]',
                )}
              >
                <div
                  ref={tiltRef}
                  onMouseMove={handleTilt}
                  onMouseLeave={resetTilt}
                  className="tilt-inner relative overflow-hidden rounded-[26px] bg-card"
                >
                  {isVideo ? (
                    <VideoPlayerFrame
                      slug={product.slug}
                      poster={images[0]}
                      title={product.title}
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="relative aspect-[4/3] w-full">
                      {images.map((src, i) => (
                        <img
                          key={`${src}-${i}`}
                          src={src}
                          alt={`${product.title} — image ${i + 1} of ${images.length}`}
                          onError={imgFallbackToHq}
                          className={cn(
                            'absolute inset-0 h-full w-full object-cover transition-all duration-500',
                            i === activeImg ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0',
                          )}
                        />
                      ))}
                      {/* glass sheen for a premium finish */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.14),transparent_38%)]"
                      />
                    </div>
                  )}
                  {!isVideo && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-sm"
                    >
                      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <circle cx="9" cy="10" r="1.6" />
                        <path d="m21 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L7 18" />
                      </svg>
                      {activeImg + 1} / {images.length}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {images.length > 1 && (
            <div className="nice-scroll mt-4 flex gap-2.5 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button
                  key={`thumb-${i}`}
                  type="button"
                  onClick={() => {
                    setActiveImg(i)
                    playFx('pop')
                  }}
                  aria-label={`Show image ${i + 1} of ${images.length}`}
                  aria-pressed={i === activeImg}
                  className={cn(
                    'relative size-16 shrink-0 overflow-hidden rounded-2xl p-[2px] transition-all duration-300 md:size-[72px]',
                    i === activeImg
                      ? isKids
                        ? 'bg-[linear-gradient(135deg,#FFB347,#FF8A3D)] shadow-[0_6px_18px_rgba(255,136,0,0.35)]'
                        : 'bg-[linear-gradient(135deg,#00F0FF,#00F5A0)] shadow-[0_6px_18px_rgba(0,240,255,0.3)]'
                      : 'bg-border opacity-65 hover:opacity-100',
                  )}
                >
                  <img
                    src={src}
                    alt=""
                    onError={imgFallbackToHq}
                    className="h-full w-full rounded-[14px] object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT: details ── */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {product.badge && (
              <span className="brutal-sticker bg-[#FFB347] px-2.5 py-1 text-xs font-extrabold text-[#4a2800]">
                {product.badge}
              </span>
            )}
            <span
              className={cn(
                'rounded-full px-3 py-1 text-xs font-bold',
                isKids ? 'bg-[#FFF2CC] text-[#8a5a20]' : 'mono-tag',
              )}
            >
              {isKids ? '🎨 Kids Zone' : '⚡ Creator Hub'}
            </span>
          </div>

          <h1
            className={cn(
              'mt-3 text-3xl leading-tight md:text-[2.6rem] md:leading-[1.15]',
              isKids ? 'font-baloo toon-text kids-3d-head font-extrabold text-[#4a3b2a]' : 'font-jetbrains font-bold text-foreground',
            )}
          >
            {product.title}
          </h1>

          {/* author · age · rating pill */}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-2 rounded-full border border-border bg-card/70 py-1 pl-1 pr-3">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 place-items-center rounded-full text-sm',
                  isKids
                    ? 'bg-gradient-to-br from-[#FFB347] to-[#FF8A3D] text-[#4a2800]'
                    : 'bg-gradient-to-br from-[#00F0FF]/80 to-[#00F5A0]/80 text-[#001318]',
                )}
              >
                {isKids ? '🧸' : '⚡'}
              </span>
              <span className="text-sm font-semibold text-foreground/90">by {product.authorBrand}</span>
            </span>
            {product.ageOrLevel && (
              <span className="rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs font-bold text-foreground/80">
                {product.ageOrLevel}
              </span>
            )}
            <span
              className="flex items-center gap-1.5 rounded-full border border-[#E5B842]/40 bg-[#E5B842]/10 px-2.5 py-1"
              aria-label="Rated 5 out of 5 stars"
            >
              <span className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-3.5 fill-[#E5B842] text-[#E5B842]" aria-hidden="true" />
                ))}
              </span>
              <span className="font-jetbrains text-[11px] font-bold text-[#8c6a1e]">5.0</span>
            </span>
          </div>

          <p className="mt-5 text-sm leading-relaxed text-foreground/90 md:text-base">{product.description}</p>

          {/* ── Premium buy box ── */}
          <div
            className={cn(
              'relative mt-6 overflow-hidden rounded-3xl border p-5 shadow-[0_18px_44px_rgba(0,0,0,0.12)] backdrop-blur-md md:p-6',
              isKids
                ? 'border-[#FFB347]/50 bg-white/80'
                : 'border-[#00F0FF]/25 bg-[#101416]/85',
            )}
          >
            {/* top gradient hairline + corner glow */}
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-0 top-0 h-[3px]',
                isKids
                  ? 'bg-[linear-gradient(90deg,transparent,#FFB347,#FF8A3D,transparent)]'
                  : 'bg-[linear-gradient(90deg,transparent,#00F0FF,#00F5A0,transparent)]',
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute -right-10 -top-10 size-32 rounded-full blur-2xl',
                isKids ? 'bg-[#FFB347]/25' : 'bg-[#00F0FF]/15',
              )}
            />

            <div className="relative flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    'text-[2.5rem] font-extrabold leading-none tracking-tight md:text-5xl',
                    isKids
                      ? 'bg-[linear-gradient(120deg,#E67300,#FF8A3D)] bg-clip-text text-transparent'
                      : 'bg-[linear-gradient(120deg,#00F0FF,#00F5A0)] bg-clip-text text-transparent',
                  )}
                >
                  {money.inr}
                </span>
                <span className="text-lg font-semibold text-muted-foreground">{money.usd}</span>
              </div>
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-bold',
                  isKids ? 'bg-[#FFF2CC] text-[#8a5a20]' : 'mono-tag',
                )}
              >
                {product.instantDownload ? '⚡ Instant delivery' : '🛒 Marketplace order'}
              </span>
            </div>
            <p className="relative mt-1 text-[11px] font-medium text-muted-foreground">
              Final price shown in your currency — inclusive of all taxes.
            </p>

            <div className="relative mt-4">
              <CheckoutButtons product={product} />
            </div>

            <ul className="relative mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-dashed border-border/70 pt-4 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <ShieldCheck className={cn('size-4', isKids ? 'text-[#E67300]' : 'text-[#00F0FF]')} aria-hidden="true" /> Secure UPI, card & net banking payments
              </li>
              <li className="flex items-center gap-1.5">
                <Zap className={cn('size-4', isKids ? 'text-[#E67300]' : 'text-[#00F0FF]')} aria-hidden="true" /> Instant email delivery on ⚡ items
              </li>
              <li className="flex items-center gap-1.5">
                <RefreshCcw className={cn('size-4', isKids ? 'text-[#E67300]' : 'text-[#00F0FF]')} aria-hidden="true" /> 7-day support
              </li>
            </ul>
          </div>

          {product.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {product.tags.map((t) => (
                <span key={t} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Tabs */}
          <Tabs defaultValue="inside" className="mt-8">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-full border border-border/70 bg-card/60 p-1 sm:justify-start">
              <TabsTrigger value="inside" className="min-h-[44px] rounded-full px-4">
                What&apos;s inside
              </TabsTrigger>
              <TabsTrigger value="formats" className="min-h-[44px] rounded-full px-4">
                Formats
              </TabsTrigger>
              <TabsTrigger value="how" className="min-h-[44px] rounded-full px-4">
                How to use
              </TabsTrigger>
              <TabsTrigger value="licence" className="min-h-[44px] rounded-full px-4">
                Licence
              </TabsTrigger>
            </TabsList>

            <TabsContent value="inside" className="mt-4">
              <div className="rounded-2xl border border-border/60 bg-card/50 p-4 md:p-5">
                <ul className="space-y-2.5">
                  {product.whatsInside.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
                          isKids ? 'bg-[#FFB347]/25 text-[#B25E00]' : 'bg-[#00F0FF]/15 text-[#00F0FF]',
                        )}
                      >
                        <Sparkles className="size-3" />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                  {product.whatsInside.length === 0 && (
                    <li className="text-sm text-muted-foreground">A delightful pack of digital goodies.</li>
                  )}
                </ul>
                {product.pageCount !== null && (
                  <p className="mt-4 inline-block rounded-full bg-muted px-3 py-1 text-xs font-bold">
                    {isKids ? `🖼️ ${product.pageCount} pages of fun` : `📄 ${product.pageCount} pages`}
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="formats" className="mt-4">
              <div className="rounded-2xl border border-border/60 bg-card/50 p-4 md:p-5">
                <div className="flex flex-wrap gap-2">
                  {(product.fileFormats.length > 0 ? product.fileFormats : ['Digital download']).map((f) => (
                    <span key={f} className="rounded-md border border-border bg-card px-3 py-1.5 font-mono text-xs font-bold uppercase">
                      {f}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {product.instantDownload
                    ? '⚡ Instant email delivery — your download link arrives within seconds of payment.'
                    : 'Delivered by your chosen store (Amazon KDP, Etsy, Gumroad…) right after checkout.'}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="how" className="mt-4">
              <div className="rounded-2xl border border-border/60 bg-card/50 p-4 md:p-5">
                <p className="text-sm leading-relaxed text-foreground/90">
                  {product.howToUse || 'Download, open and go — everything is ready to use right away.'}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="licence" className="mt-4">
              <div className="rounded-2xl border border-border/60 bg-card/50 p-4 md:p-5">
                <p className="text-sm leading-relaxed text-foreground/90">{LICENSE_COPY[product.license]}</p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Layer 2 — verified-purchase reviews (renders nothing until a
          buyer review is approved, so existing pages stay unchanged). */}
      <ProductReviews slug={product.slug} isKids={isKids} />

      {/* Related rail */}
      {related.length > 0 && (
        <section className="mt-14" aria-label="Related products">
          <h2
            className={cn(
              'text-xl md:text-2xl',
              isKids ? 'font-baloo toon-text kids-3d-head font-extrabold text-[#4a3b2a]' : 'font-jetbrains font-bold text-foreground',
            )}
          >
            {isKids ? 'More treasures like this 🎁' : 'More in the Hub'}
          </h2>
          <div className="nice-scroll mt-4 flex gap-4 overflow-x-auto pb-2">
            {related.map((r) => (
              <div key={r.id} className="w-[260px] shrink-0 sm:w-[300px]">
                {isKids ? (
                  <SmartProductCard product={r} openHref={realLinks ? realProductPath(r.slug) : undefined} />
                ) : (
                  <CreatorCard product={r} openHref={realLinks ? realProductPath(r.slug) : undefined} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Slim sticky mobile buy bar — price + ONE primary CTA.
          All other purchase options stay in the content column
          above, so the bar can never stack up and cover the UI. */}
      <motion.div
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.4, type: 'spring', stiffness: 220, damping: 26 }}
        className="glass fixed inset-x-0 bottom-0 z-40 px-3 py-2.5 lg:hidden"
        style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 h-[2px]',
            isKids
              ? 'bg-[linear-gradient(90deg,transparent,#FFB347,#FF8A3D,transparent)]'
              : 'bg-[linear-gradient(90deg,transparent,#00F0FF,#00F5A0,transparent)]',
          )}
        />
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex w-[76px] shrink-0 flex-col leading-tight">
            <span className={cn('text-lg font-extrabold', isKids ? 'text-[#E67300]' : 'text-[#00F0FF]')}>
              {money.inr}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{money.usd}</span>
          </div>
          <div className="min-w-0 flex-1">
            <CheckoutButtons product={product} primaryOnly />
          </div>
        </div>
      </motion.div>
    </div>
  )
}
