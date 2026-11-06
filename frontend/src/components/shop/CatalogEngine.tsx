'use client'

// ═══════════════════════════════════════════════════════════
// CatalogEngine — the Universal Catalog (PRD §8). One engine,
// two moods: Kids Zone (clay grid of flip cards) vs Creator
// Hub (cyber bento). Zone/category changes are pushed through
// the SPA store so the hash stays deep-linkable.
// ═══════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, RotateCcw, Search } from 'lucide-react'
import { parseProduct, useAppStore } from '@/store/app-store'
import { realProductPath } from '@/lib/real-routes'
import type { Product, ProductRow, RatingSummary, Zone } from '@/types/marketplace'
import { hydrateCategories, useZoneCategories } from '@/lib/categories'
import { playFx } from '@/lib/sound-fx'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SmartProductCard } from '@/components/shop/SmartProductCard'
import { CreatorCard } from '@/components/shop/CreatorCard'

const SORTS: { value: string; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
]

/** Page-number sequence with ellipsis gaps when the count is large
 *  (owner-request pagination: every page shows as many products as
 *  the grid fits — 12 on md+ screens, 6 on mobile). */
function pageSequence(current: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const wanted = new Set([1, count, current - 1, current, current + 1])
  const nums = [...wanted].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b)
  const seq: (number | '…')[] = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev > 1) seq.push('…')
    seq.push(n)
    prev = n
  }
  return seq
}

function KidsSkeleton() {
  return (
    <div className="rounded-[24px] border border-[#FFB347]/30 bg-white/70 p-3 shadow-sm">
      <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
      <Skeleton className="mt-3 h-4 w-3/4 rounded-full" />
      <Skeleton className="mt-2 h-4 w-1/2 rounded-full" />
    </div>
  )
}

function CreatorSkeleton() {
  return (
    <div className="cyber-card overflow-hidden">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

interface CatalogState {
  key: string
  products: Product[]
  error: boolean
}

/** Server-rendered seed for the real /shop + /category routes: the page
 *  fetches the same catalog query on the server and passes it here so the
 *  first HTML already contains the product grid. The SPA hash view never
 *  passes it — behaviour there is byte-for-byte unchanged. */
export interface CatalogInitialData {
  key: string
  products: Product[]
}

export function CatalogEngine({ initial }: { initial?: CatalogInitialData }) {
  const { toast } = useToast()
  const navigate = useAppStore((s) => s.navigate)
  const storeZone = useAppStore((s) => s.zone)
  const storeCategory = useAppStore((s) => s.category)
  const storeSearch = useAppStore((s) => s.search)
  const storeSort = useAppStore((s) => s.sort)

  // Committed filter state lives in the SPA store (it IS route state):
  // zone/category/search/sort derive straight from it, so the hash, the
  // grid and browser back/forward can never drift apart. The only local
  // state is the raw search-box buffer (committed on a 350ms debounce).
  const zone: Zone = storeZone ?? 'kids'
  const category = storeCategory
  const search = storeSearch
  const sort = storeSort

  const [searchInput, setSearchInput] = useState(storeSearch)
  const [reload, setReload] = useState(0)

  const [data, setData] = useState<CatalogState>(
    initial ? { key: initial.key, products: initial.products, error: false } : { key: '', products: [], error: false },
  )

  // Back/forward (or any outside store change): mirror into the raw input
  // during render — React's "adjust state when a dependency changes"
  // pattern. Our own debounce commit lands on the same value, so typing is
  // never clobbered (identical setState bails out).
  const [prevStoreSearch, setPrevStoreSearch] = useState(storeSearch)
  if (prevStoreSearch !== storeSearch) {
    setPrevStoreSearch(storeSearch)
    setSearchInput(storeSearch)
  }

  // Debounced search commit (350ms) — writes the store + the hash via a
  // replaceState so search-as-you-type never spams the history stack.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput === useAppStore.getState().search) return
      navigate('shop', { zone, category, search: searchInput, sort }, { replace: true })
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput, zone, category, sort, navigate])

  // T10: live admin-managed categories (shared single fetch)
  useEffect(() => {
    void hydrateCategories()
  }, [])

  // Default to the Kids theme when no zone was ever chosen
  useEffect(() => {
    if (!useAppStore.getState().zone) {
      document.documentElement.dataset.zone = 'kids'
    }
  }, [])

  // Layer 2 — verified-purchase rating summaries for the cards. One cached
  // (60 s) batched fetch; only products WITH approved reviews appear, so
  // the map is empty until the first review is approved.
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({})
  useEffect(() => {
    const ac = new AbortController()
    fetch('/api/reviews/product/summary', { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ ratings?: Record<string, RatingSummary> }>) : null))
      .then((d) => {
        if (d?.ratings) setRatings(d.ratings)
      })
      .catch(() => {
        /* cards simply render without the rating pill */
      })
    return () => ac.abort()
  }, [reload])

  // Fetch products — loading/error are derived from the request key
  const requestKey = `${zone}|${category ?? ''}|${search.trim()}|${sort}|${reload}`
  const loading = data.key !== requestKey
  const error = data.error
  const products = data.products

  // ── All-Products pagination (owner request) ──
  // Every page shows exactly what the grid fits: 12 cards on the md+
  // multi-column grids, 6 on mobile. Prev/Next + page numbers below the
  // grid move the whole page at once, on web and mobile alike.
  //
  // Desktop/mobile page size: initial state MUST be deterministic (false)
  // because this component server-renders on the real /shop + /category
  // routes; the layout effect applies the real value before paint, so the
  // client-only hash view behaves exactly as before (no visible change).
  const [isDesktop, setIsDesktop] = useState(false)
  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const [page, setPage] = useState(1)
  // Filter changes (zone/category/search/sort/retry) always land on page 1 —
  // the same "adjust state during render" pattern used for the search box.
  const [prevRequestKey, setPrevRequestKey] = useState(requestKey)
  if (prevRequestKey !== requestKey) {
    setPrevRequestKey(requestKey)
    setPage(1)
  }

  const perPage = isDesktop ? 12 : 6
  const pageCount = Math.max(1, Math.ceil(products.length / perPage))
  const currentPage = Math.min(page, pageCount)
  const pageProducts = products.slice((currentPage - 1) * perPage, currentPage * perPage)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const goPage = (p: number) => {
    if (p === currentPage) return
    playFx('pop')
    setPage(p)
    // Bring the refreshed grid back into view (scroll-mt clears the navbar)
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const ac = new AbortController()
    const params = new URLSearchParams({ zone, sort, limit: '60' })
    if (category) params.set('category', category)
    if (search.trim()) params.set('q', search.trim())
    fetch(`/api/products?${params.toString()}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error('failed')
        return r.json() as Promise<{ products: ProductRow[] }>
      })
      .then((d) => {
        setData({
          key: requestKey,
          products: d.products.map((row) => parseProduct(row as unknown as Record<string, unknown>) as unknown as Product),
          error: false,
        })
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return
        setData({ key: requestKey, products: [], error: true })
        playFx('error')
        toast({ title: 'Could not load treasures', description: 'The catalog failed to load. Try again in a moment.' })
      })
    return () => ac.abort()
  }, [requestKey, zone, category, search, sort, toast])

  const applyZone = (z: Zone) => {
    if (z === zone) return
    playFx('whoosh')
    document.documentElement.dataset.zone = z
    useAppStore.getState().setCanvasMood(z === 'kids' ? 0 : 1)
    navigate('shop', { zone: z, category: null, search, sort })
  }

  const applyCategory = (c: string | null) => {
    playFx('pop')
    navigate('shop', { zone, category: c, search, sort })
  }

  const applySort = (v: string) => {
    playFx('pop')
    // replaceState — a sort tweak is the same listing, not a new "page".
    navigate('shop', { zone, category, search, sort: v }, { replace: true })
  }

  const clearFilters = () => {
    playFx('chime')
    setSearchInput('')
    // Explicit values — nothing stale can leak back into the hash (that
    // was the "cleared search still stuck in the URL" bug).
    navigate('shop', { zone, category: null, search: '', sort: 'featured' })
  }

  const cats = useZoneCategories(zone)
  const isKids = zone === 'kids'

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 md:px-6 md:pt-10">
      {/* Zone switch */}
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Choose a zone"
          className="flex rounded-full border-2 border-black/10 bg-white/60 p-1 shadow-inner dark:bg-white/5"
        >
          {(['kids', 'creator'] as Zone[]).map((z) => (
            <button
              key={z}
              type="button"
              role="tab"
              aria-selected={zone === z}
              onClick={() => applyZone(z)}
              className="relative min-h-[44px] rounded-full px-5 py-2 text-sm font-extrabold outline-none md:px-7 md:text-base"
            >
              {zone === z && (
                <motion.span
                  layoutId="zonePill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className={cn(
                    'absolute inset-0 rounded-full',
                    z === 'kids'
                      ? 'bg-gradient-to-r from-[#FFB347] to-[#FFD07A] shadow-[0_4px_14px_rgba(255,179,71,0.5)]'
                      : 'bg-gradient-to-r from-[#00F0FF] to-[#00F5A0] shadow-[0_4px_14px_rgba(0,240,255,0.4)]',
                  )}
                />
              )}
              <span className={cn('relative z-10', zone === z && (z === 'kids' ? 'text-[#4a2800]' : 'text-[#001318]'))}>
                {z === 'kids' ? '🎨 Kids Zone' : '⚡ Creator Hub'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Dopamine headline */}
      <AnimatePresence mode="wait">
        <motion.div
          key={zone}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.3 }}
          className="mt-6 text-center"
        >
          <h1
            className={cn(
              'chameleon-sweep text-2xl md:text-4xl',
              isKids ? 'font-baloo toon-text kids-3d-head font-extrabold text-[#4a3b2a]' : 'font-jetbrains holo-text font-bold',
            )}
          >
            {isKids ? '🚀 Unbox Joy in Minutes!' : '⚡ Build Faster. Earn Sooner.'}
          </h1>
          <p className="shop-sub mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
            {isKids
              ? 'Printable magic for little minds — colour, solve, giggle, repeat.'
              : 'Premium assets that ship your ideas this weekend, not next month.'}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search products…"
            aria-label="Search products"
            className="shop-search h-11 pl-9"
          />
        </div>

        <Select
          value={sort}
          onValueChange={applySort}
        >
          <SelectTrigger aria-label="Sort products" className="h-11 w-[150px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p
          className={cn(
            'ml-auto',
            isKids ? 'font-baloo text-sm font-bold text-[#7a4a00]' : 'font-jetbrains text-xs text-foreground/90',
          )}
          aria-live="polite"
        >
          {loading ? '…' : `${products.length} treasures`}
          {isKids ? ' to explore ✨' : ' found'}
        </p>
      </div>

      {/* Category chips */}
      <div className="nice-scroll mt-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Filter by category">
        <button
          type="button"
          onClick={() => applyCategory(null)}
          aria-pressed={category === null}
          className={cn(
            'min-h-[44px] shrink-0 rounded-full border-2 px-4 text-sm font-bold transition-all',
            category === null
              ? 'border-primary bg-primary text-primary-foreground shadow-md'
              : 'border-border bg-card/70 text-muted-foreground hover:text-foreground',
          )}
        >
          All
        </button>
        {cats.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => applyCategory(c.slug)}
            aria-pressed={category === c.slug}
            className={cn(
              'min-h-[44px] shrink-0 rounded-full border-2 px-4 text-sm font-bold transition-all',
              category === c.slug
                ? 'border-primary bg-primary text-primary-foreground shadow-md'
                : 'border-border bg-card/70 text-muted-foreground hover:text-foreground',
            )}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {/* Grid / states */}
      {error ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <span className="text-6xl" aria-hidden="true">
            📡
          </span>
          <p className={cn('text-lg font-bold', isKids && 'font-baloo toon-text')}>
            The treasure chest is stuck — let&apos;s try that again.
          </p>
          <Button onClick={() => setReload((n) => n + 1)} className="h-11 min-w-[160px]">
            <RotateCcw className="size-4" aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : loading ? (
        <div
          className={cn(
            'mt-8 grid gap-4 md:gap-6',
            isKids ? 'grid-cols-1 md:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
          )}
        >
          {Array.from({ length: 8 }).map((_, i) => (isKids ? <KidsSkeleton key={i} /> : <CreatorSkeleton key={i} />))}
        </div>
      ) : products.length === 0 ? (
        <div className="col-span-full mt-10 flex flex-col items-center gap-4 text-center">
          <span className="text-6xl" aria-hidden="true">
            {isKids ? '🧭' : '🛰️'}
          </span>
          <p className={cn('text-xl font-bold', isKids ? 'font-baloo toon-text' : 'font-jetbrains')}>
            No treasures found — try another category!
          </p>
          <Button onClick={clearFilters} className="h-11 min-w-[160px]">
            Clear filters
          </Button>
        </div>
      ) : (
        <div
          ref={gridRef}
          className={cn(
            'mt-8 grid scroll-mt-24 gap-4 md:gap-6',
            isKids ? 'grid-cols-1 md:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
          )}
        >
          <AnimatePresence mode="popLayout">
            {pageProducts.map((p) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.28 }}
              >
                {isKids ? (
                  <SmartProductCard product={p} rating={ratings[p.id] ?? null} openHref={initial ? realProductPath(p.slug) : undefined} />
                ) : (
                  <CreatorCard product={p} size={p.featured ? 'lg' : 'md'} rating={ratings[p.id] ?? null} openHref={initial ? realProductPath(p.slug) : undefined} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Pagination — same controls on web and mobile, only the page
          size differs (12 on md+ grids / 6 on mobile) */}
      {!error && !loading && products.length > 0 && pageCount > 1 && (
        <nav aria-label="Product pages" className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => goPage(currentPage - 1)}
            disabled={currentPage === 1}
            aria-label="Previous page"
            className={cn(
              'flex h-11 items-center justify-center rounded-full border-2 px-4 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40',
              isKids
                ? 'border-[#FFB347]/60 bg-white/70 text-[#8a5a20] hover:bg-[#FFB347]/20'
                : 'border-[#00F0FF]/50 bg-black/40 font-jetbrains text-[#00F0FF] hover:bg-[#00F0FF]/10',
            )}
          >
            ‹ Prev
          </button>
          {pageSequence(currentPage, pageCount).map((n, i) =>
            n === '…' ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-sm text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={`page-${n}`}
                type="button"
                onClick={() => goPage(n)}
                aria-label={`Page ${n}`}
                aria-current={n === currentPage ? 'page' : undefined}
                className={cn(
                  'flex size-11 items-center justify-center rounded-full border-2 text-sm font-bold transition-all',
                  n === currentPage
                    ? isKids
                      ? 'border-primary bg-primary text-primary-foreground shadow-md'
                      : 'border-[#00F0FF] bg-[#00F0FF]/15 text-[#00F0FF]'
                    : isKids
                      ? 'border-border bg-card/70 text-muted-foreground hover:text-foreground'
                      : 'border-[#00F0FF]/30 bg-black/30 text-muted-foreground hover:text-[#00F0FF]',
                )}
              >
                {n}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => goPage(currentPage + 1)}
            disabled={currentPage === pageCount}
            aria-label="Next page"
            className={cn(
              'flex h-11 items-center justify-center rounded-full border-2 px-4 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40',
              isKids
                ? 'border-[#FFB347]/60 bg-white/70 text-[#8a5a20] hover:bg-[#FFB347]/20'
                : 'border-[#00F0FF]/50 bg-black/40 font-jetbrains text-[#00F0FF] hover:bg-[#00F0FF]/10',
            )}
          >
            Next ›
          </button>
        </nav>
      )}

      {loading && !error && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
          <span className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Summoning treasures…
          </span>
        </div>
      )}
    </div>
  )
}
