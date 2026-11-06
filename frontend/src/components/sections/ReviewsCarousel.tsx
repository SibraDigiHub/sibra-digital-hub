'use client'

// ═══════════════════════════════════════════════════════════
// §11.3.3 — "The Words That Inspire Us" (Wall of Love)
// Infinite RTL testimonial marquee reusing the journey CSS.
// Fetches /api/reviews; falls back to built-in samples ONLY when
// the fetch itself fails — a 200 with zero reviews renders the
// honest "Reviews coming soon" state (no fake samples, and the
// header never claims "real" results when none exist).
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, MessageCircleHeart, Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { Review } from '@/types/marketplace'
import { useStaggerReveal } from '@/hooks/useStaggerReveal'
import { useMarqueeFallback } from '@/hooks/useMarqueeFallback'

/** Built-in samples shown while loading or if the API fails */
const FALLBACK_REVIEWS: Review[] = [
  {
    id: 'fb-kids-1',
    name: 'Priya S.',
    role: 'Mom of 4yo',
    avatarEmoji: '👩',
    content:
      'My daughter asks for colouring time every evening now. The print quality at home is amazing!',
    rating: 5,
    zone: 'kids',
    verified: true,
    sortOrder: 1,
    createdAt: '',
  },
  {
    id: 'fb-creator-1',
    name: 'Arjun M.',
    role: 'Freelancer',
    avatarEmoji: '🧑‍🎨',
    content:
      'The Canva vault replaced months of design work. Clients noticed.',
    rating: 5,
    zone: 'creator',
    verified: true,
    sortOrder: 2,
    createdAt: '',
  },
  {
    id: 'fb-kids-2',
    name: 'Rahul V.',
    role: 'Dad of two',
    avatarEmoji: '🧔',
    content:
      'Dino pack saved a 6-hour train journey. Worth every rupee!',
    rating: 5,
    zone: 'kids',
    verified: true,
    sortOrder: 3,
    createdAt: '',
  },
  {
    id: 'fb-creator-2',
    name: 'Sana K.',
    role: 'Creator',
    avatarEmoji: '🧕',
    content:
      'Prompts pack paid for itself in one reel. Instant download took 20 seconds!',
    rating: 5,
    zone: 'creator',
    verified: true,
    sortOrder: 4,
    createdAt: '',
  },
]

function normalizeReview(raw: unknown, i: number): Review | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name : ''
  const content = typeof o.content === 'string' ? o.content : ''
  if (!name || !content) return null
  return {
    id: typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : `api-${i}`,
    name,
    role: typeof o.role === 'string' ? o.role : '',
    avatarEmoji: typeof o.avatarEmoji === 'string' ? o.avatarEmoji : '⭐',
    content,
    rating:
      typeof o.rating === 'number' && o.rating >= 1 && o.rating <= 5
        ? Math.round(o.rating)
        : 5,
    zone: o.zone === 'creator' ? 'creator' : 'kids',
    verified: Boolean(o.verified),
    sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : i,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
  }
}


export default function ReviewsCarousel() {
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useStaggerReveal<HTMLElement>({ deps: [reviews] })
  // Self-healing marquee: keeps the Wall of Love gliding even
  // on devices that suppress CSS animations (reduced-motion).
  // Re-attaches once the async reviews replace the skeleton.
  useMarqueeFallback(trackRef, 55, [reviews])

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const res = await fetch('/api/reviews', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { reviews?: unknown }
        const raw = Array.isArray(data.reviews) ? data.reviews : []
        const list = raw
          .map(normalizeReview)
          .filter((r): r is Review => r !== null)
          .sort((a, b) => a.sortOrder - b.sortOrder)
        if (!alive) return
        // API contract: if more than 8 arrive, show at most 10
        const trimmed = list.length > 8 ? list.slice(0, 10) : list
        // An empty list is a REAL state (admin has not published any
        // reviews yet) — never replace it with the sample fallback:
        // that would fabricate testimonials that don't exist.
        setReviews(trimmed)
      } catch {
        // Fetch/HTTP failure only — keep the built-in samples so the
        // section never renders blank because of a network blip.
        if (alive) setReviews(FALLBACK_REVIEWS)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  // Loop-fill so the seam never shows on wide screens with few reviews
  const loopList =
    reviews !== null && reviews.length > 0 && reviews.length < 6
      ? [...reviews, ...reviews]
      : (reviews ?? [])

  // `copy` + index make every rendered key unique even when the
  // loop-fill pads the list with a second copy of each review
  // (previously `key={r.id}` collided inside the padded array —
  // React "two children with the same key" warnings).
  const renderCard = (r: Review, copy: 'main' | 'ghost', i: number) => (
    <figure
      key={`${copy}-${r.id}-${i}`}
      className={`flex w-80 shrink-0 flex-col rounded-3xl p-5 transition-transform duration-300 hover:-translate-y-1 ${
        r.zone === 'kids'
          ? 'bg-gradient-to-br from-[#FFF8E7] to-[#FFF2CC] text-[#4a3b2a] shadow-[0_10px_30px_rgba(255,136,0,0.16)]'
          : 'border border-[#00F0FF]/30 bg-[#101416]/90 text-[#E8F6F2] shadow-[0_10px_30px_rgba(0,240,255,0.10)] backdrop-blur-md'
      }`}
    >
      {/* Stars + zone chip */}
      <div className="flex items-center justify-between gap-3">
        <span
          role="img"
          aria-label={`Rated ${r.rating} out of 5 stars`}
          className="flex items-center gap-0.5"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              aria-hidden="true"
              className={`h-4 w-4 ${
                i < r.rating
                  ? 'fill-[#E5B842] text-[#E5B842]'
                  : 'text-[#E5B842]/30'
              }`}
            />
          ))}
        </span>
        <span
          className="mono-tag"
          style={
            r.zone === 'kids'
              ? {
                  color: '#8c6a1e',
                  borderColor: 'rgba(255, 179, 71, 0.55)',
                  background: 'rgba(255, 179, 71, 0.12)',
                }
              : undefined
          }
        >
          {r.zone === 'kids' ? 'Kids World' : 'Creator'}
        </span>
      </div>

      {/* Review text */}
      <blockquote
        className={`mt-3 line-clamp-4 text-sm leading-relaxed ${
          r.zone === 'kids' ? 'text-[#4a3b2a]' : 'text-[#C9E8E2]'
        }`}
      >
        “{r.content}”
      </blockquote>

      {/* Author */}
      <figcaption className="mt-auto flex items-center gap-3 pt-4">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ${
            r.zone === 'kids'
              ? 'bg-[#FFB347]/25 ring-2 ring-[#FFB347]/40'
              : 'bg-[#00F0FF]/10 ring-2 ring-[#00F0FF]/30'
          }`}
        >
          {r.avatarEmoji}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{r.name}</span>
            {r.verified && (
              <BadgeCheck
                aria-label="Verified buyer"
                className="h-4 w-4 shrink-0 text-[#00F5A0]"
              />
            )}
          </span>
          <span
            className={`block truncate text-xs ${
              r.zone === 'kids' ? 'text-[#7a5a30]' : 'text-[#6FA7A0]'
            }`}
          >
            {r.role}
          </span>
        </span>
      </figcaption>
    </figure>
  )

  return (
    <section
      ref={headerRef}
      aria-labelledby="reviews-heading"
      aria-busy={reviews === null}
      className="relative py-16 md:py-24"
    >
      {/* ── Section header ── */}
      <div className="reveal mx-auto max-w-3xl px-4 text-center">
        <p className="sec-eyebrow font-jetbrains text-xs font-semibold tracking-[0.3em] text-[#E5B842]">
          ── WALL OF LOVE ──
        </p>
        <h2
          id="reviews-heading"
          className="sec-heading chameleon-sweep font-playfair mt-4 text-3xl leading-tight font-semibold text-foreground md:text-5xl"
        >
          The Words That <span className="holo-text">Inspire Us</span>
        </h2>
        <p className="shop-sub mt-4 text-sm text-muted-foreground md:text-base">
          {reviews !== null && reviews.length === 0
            ? 'Honest stories from our first customers are on the way.'
            : 'Real families. Real creators. Real results.'}
        </p>
      </div>

      {/* ── Infinite RTL marquee (55s, hover pauses via CSS) ── */}
      <div className="relative mt-10 md:mt-14">
        <div className="journey-wrap w-full overflow-hidden">
          {reviews === null ? (
            <div
              className="flex w-max gap-6 px-4"
              role="status"
              aria-label="Loading reviews"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-56 w-80 shrink-0 rounded-3xl bg-[#E5B842]/10"
                />
              ))}
            </div>
          ) : reviews.length === 0 ? (
            /* 200 with an empty list — no published reviews yet.
               Small honest state instead of sample testimonials. */
            <div
              role="status"
              className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-3xl border border-dashed border-[#E5B842]/40 bg-[#FFF8E7]/60 px-8 py-10 text-center"
            >
              <MessageCircleHeart
                aria-hidden="true"
                className="h-8 w-8 text-[#E5B842]"
              />
              <p className="font-playfair text-xl font-semibold text-foreground">
                Reviews coming soon
              </p>
              <p className="text-sm text-muted-foreground">
                We just opened the shop — the first verified buyer stories
                will appear right here.
              </p>
            </div>
          ) : (
            <div ref={trackRef} className="journey-track" style={{ gap: 0 }}>
              <div className="flex shrink-0 gap-6 pr-6">
                {loopList.map((r, i) => renderCard(r, 'main', i))}
              </div>
              <div
                className="flex shrink-0 gap-6 pr-6"
                aria-hidden="true"
              >
                {loopList.map((r, i) => renderCard(r, 'ghost', i))}
              </div>
            </div>
          )}
        </div>
        {/* Edge fades into the zone backdrop */}
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
