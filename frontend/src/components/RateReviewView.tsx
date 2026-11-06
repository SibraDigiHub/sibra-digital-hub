'use client'

// ═══════════════════════════════════════════════════════════
// Rate view — verified-purchase review page (SPA route
// #/rate/[token]). The token is the buyer's own order token
// (from the delivery email / thank-you page), so no account is
// needed and one order can leave exactly one review. Every
// submission lands in the admin moderation queue — it only
// appears on the product page after an admin approves it.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, Check, Loader2, ShieldCheck, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store/app-store'
import { playFx } from '@/lib/sound-fx'
import { cn } from '@/lib/utils'
import type { ReviewOrderContext } from '@/types/marketplace'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; ctx: ReviewOrderContext }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'] as const

function Stars({
  value,
  onChange,
  size = 'size-8',
}: {
  value: number
  onChange?: (v: number) => void
  size?: string
}) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="flex items-center gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''} — ${RATING_LABELS[n - 1]}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => {
              playFx('pop')
              onChange(n)
            }}
            className="rounded transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e5b842]"
          >
            <Star
              className={cn(size, n <= shown ? 'fill-[#e5b842] text-[#e5b842]' : 'text-white/25')}
              aria-hidden="true"
            />
          </button>
        ) : (
          <Star key={n} className={cn(size, n <= shown ? 'fill-[#e5b842] text-[#e5b842]' : 'text-white/25')} aria-hidden="true" />
        ),
      )}
    </div>
  )
}

export default function RateReviewView() {
  const token = useAppStore((s) => s.downloadToken)
  const navigate = useAppStore((s) => s.navigate)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Token whose review context has landed (or errored). Hash-only
  // navigation between two rate links does NOT reload the page, so the
  // fetch must re-run (and the old request abort) whenever it changes.
  // Kept as STATE (not a ref) because the render derives the shown card
  // from it — a token whose fetch has not landed yet must display the
  // loading card, never the previous token's data.
  const [fetchedFor, setFetchedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!token || fetchedFor === token) return
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/reviews/order?token=${encodeURIComponent(token)}`, { signal: ac.signal })
        const data = (await res.json().catch(() => null)) as (ReviewOrderContext & { error?: string }) | null
        if (ac.signal.aborted) return
        setFetchedFor(token)
        if (!res.ok || !data?.product) {
          setState({ kind: 'error', message: data?.error || 'This review link is not valid' })
          return
        }
        setName(data.customerName)
        setRating(data.review?.rating ?? 0)
        setText(data.review?.text ?? '')
        setState({ kind: 'ready', ctx: data })
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setFetchedFor(token)
        setState({ kind: 'error', message: 'Could not reach the server. Check your connection and retry.' })
      }
    })()
    return () => ac.abort()
  }, [token, fetchedFor])

  const shown: State = token ? (fetchedFor === token ? state : { kind: 'loading' }) : { kind: 'missing' }

  const submit = useCallback(async () => {
    if (!token || submitting || rating < 1) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/reviews/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, rating, text: text.trim(), name: name.trim() || undefined }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (res.status === 409) {
        setState({ kind: 'error', message: data?.error ?? 'This order has already been reviewed' })
        return
      }
      if (!res.ok) {
        setState({ kind: 'error', message: data?.error ?? 'Could not submit your review right now' })
        return
      }
      playFx('sparkle')
      setState({ kind: 'sent' })
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Check your connection and retry.' })
    } finally {
      setSubmitting(false)
    }
  }, [token, submitting, rating, text, name])

  const ctx = shown.kind === 'ready' ? shown.ctx : null

  return (
    <div className="relative z-10 flex min-h-[80dvh] items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass w-full max-w-md rounded-3xl p-8 text-center"
      >
        {shown.kind === 'loading' && (
          <>
            <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-[#e5b842]/30 border-t-[#e5b842]" />
            <h1 className="font-cinzel text-xl text-[#fae8a7]">Opening your review page…</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">Verifying your purchase.</p>
          </>
        )}

        {shown.kind === 'ready' && ctx && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
              <ShieldCheck className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="font-cinzel text-xl text-[#fae8a7] md:text-2xl">How was your download?</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">
              <span className="font-semibold text-[#f5f8f6]">{ctx.product.title}</span> · ₹{Math.round(ctx.amountInr)}
            </p>
            <p className="mt-1 text-xs text-[#9aa89e]">
              ✅ Verified purchase — only real buyers can review, and every review is checked before it goes live.
            </p>

            {ctx.review ? (
              // One order = one review: show where it stands instead of a second form.
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-[#f5f8f6]">Your review is in — thank you! 💛</p>
                <Stars value={ctx.review.rating} size="size-6" />
                {ctx.review.text && <p className="mt-2 text-xs text-[#9aa89e]">“{ctx.review.text}”</p>}
                <p className="mt-3 text-xs text-[#9aa89e]">
                  {ctx.review.status === 'approved'
                    ? 'It is live on the product page.'
                    : ctx.review.status === 'rejected'
                      ? 'It was not published. Contact support if this is unexpected.'
                      : 'It will appear on the product page once our team approves it.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-4 text-left">
                <div className="flex flex-col items-center gap-2">
                  <Stars value={rating} onChange={setRating} />
                  <p className="text-xs font-semibold text-[#9aa89e]" aria-live="polite">
                    {rating > 0 ? RATING_LABELS[rating - 1] : 'Tap a star to rate'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="rate-name" className="text-xs font-semibold text-[#9aa89e]">
                    Display name
                  </label>
                  <Input
                    id="rate-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    placeholder="How should we show your name?"
                    className="border-white/15 bg-white/5 text-[#f5f8f6] placeholder:text-[#9aa89e]/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="rate-text" className="text-xs font-semibold text-[#9aa89e]">
                    Your review <span className="font-normal">(optional)</span>
                  </label>
                  <Textarea
                    id="rate-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder="What did you like? Would you recommend it?"
                    className="resize-none border-white/15 bg-white/5 text-[#f5f8f6] placeholder:text-[#9aa89e]/60"
                  />
                  <p className="text-right text-[10px] text-[#9aa89e]/70">{text.length}/1000</p>
                </div>

                <Button
                  onClick={() => void submit()}
                  disabled={submitting || rating < 1}
                  className="h-12 w-full rounded-full bg-gradient-to-r from-[#e5b842] to-[#c9932a] text-base font-bold text-[#050706] hover:from-[#fae8a7] hover:to-[#e5b842] disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Sending…
                    </>
                  ) : (
                    'Submit review'
                  )}
                </Button>
              </div>
            )}
          </>
        )}

        {shown.kind === 'sent' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-8 w-8 text-emerald-400" strokeWidth={3} />
            </div>
            <h1 className="font-cinzel text-xl text-[#fae8a7]">Thank you for your review! ⭐</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">
              It will appear on the product page once our team approves it — usually within a day.
            </p>
          </>
        )}

        {shown.kind === 'error' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h1 className="font-cinzel text-xl text-[#fae8a7]">Review unavailable</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">{shown.message}</p>
          </>
        )}

        {shown.kind === 'missing' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h1 className="font-cinzel text-xl text-[#fae8a7]">No review token found</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">Use the exact “Rate your download” link from your delivery email.</p>
          </>
        )}

        <Button
          variant="ghost"
          className="mt-6 text-xs text-[#9aa89e] hover:text-[#fae8a7]"
          onClick={() => navigate('shop', {})}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to shop
        </Button>
      </motion.div>
    </div>
  )
}
