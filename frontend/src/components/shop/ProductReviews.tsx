'use client'

// ═══════════════════════════════════════════════════════════
// ProductReviews — Layer 2 verified-purchase reviews section
// (product detail page). Lazy-fetches approved reviews + the
// rating summary; renders NOTHING while there are no approved
// reviews, so every product page without reviews stays
// pixel-identical to before.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublicProductReview, RatingSummary } from '@/types/marketplace'

function StarRow({ value, size = 'size-3.5' }: { value: number; size?: string }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`Rated ${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(size, n <= value ? 'fill-[#FFB347] text-[#FFB347]' : 'fill-black/10 text-black/20')} aria-hidden="true" />
      ))}
    </span>
  )
}

function reviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export function ProductReviews({ slug, isKids }: { slug: string; isKids: boolean }) {
  const [summary, setSummary] = useState<RatingSummary | null>(null)
  const [reviews, setReviews] = useState<PublicProductReview[] | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const res = await fetch(`/api/reviews/product?slug=${encodeURIComponent(slug)}`)
        if (!res.ok) return
        const data = (await res.json()) as { summary?: RatingSummary; reviews?: PublicProductReview[] }
        setSummary(data.summary ?? null)
        setReviews(Array.isArray(data.reviews) ? data.reviews : [])
      } catch {
        // Reviews are optional decoration — a failed fetch renders nothing.
      }
    })()
  }, [slug])

  // No approved reviews yet → render nothing (page unchanged).
  if (!summary || summary.count === 0 || !reviews || reviews.length === 0) return null

  return (
    <section className="mt-14" aria-label="Verified buyer reviews">
      <h2
        className={cn(
          'text-xl md:text-2xl',
          isKids
            ? 'font-baloo toon-text kids-3d-head font-extrabold text-[#4a3b2a]'
            : 'font-jetbrains font-bold text-foreground',
        )}
      >
        {isKids ? 'What buyers say ⭐' : 'Verified reviews'}
      </h2>

      <div
        className={cn(
          'mt-4 flex flex-wrap items-center gap-3 rounded-2xl border p-4',
          isKids ? 'border-[#FFB347]/40 bg-white/70' : 'border-border/60 bg-card/50',
        )}
      >
        <span className={cn('text-3xl font-extrabold', isKids ? 'text-[#B25E00]' : 'text-foreground')}>
          {summary.avg?.toFixed(1) ?? '—'}
        </span>
        <div className="flex flex-col gap-0.5">
          <StarRow value={Math.round(summary.avg ?? 0)} size="size-4" />
          <span className={cn('text-xs font-semibold', isKids ? 'text-[#8a5a20]' : 'text-muted-foreground')}>
            {summary.count} verified {summary.count === 1 ? 'review' : 'reviews'}
          </span>
        </div>
      </div>

      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {reviews.map((r) => (
          <li
            key={r.id}
            className={cn(
              'rounded-2xl border p-4',
              isKids ? 'border-[#FFB347]/30 bg-white/70' : 'border-border/60 bg-card/50',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full text-xs font-extrabold',
                    isKids ? 'bg-gradient-to-br from-[#FFB347] to-[#FF8A3D] text-[#4a2800]' : 'bg-[#00F0FF]/15 text-[#00F0FF]',
                  )}
                >
                  {(r.name.trim()[0] || '★').toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{r.name}</p>
                  <p className="text-[10px] font-semibold text-muted-foreground">{reviewDate(r.createdAt)}</p>
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="size-3" aria-hidden="true" /> Verified buyer
              </span>
            </div>
            <div className="mt-2.5">
              <StarRow value={r.rating} />
            </div>
            {r.text && <p className="mt-2 text-sm leading-relaxed text-foreground/90">{r.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
