'use client'

// ═══════════════════════════════════════════════════════════
// ThankYouView — post-checkout status (PRD §10.3). Polls
// pending orders, celebrates paid ones and clearly labels
// demo-mode email behaviour.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import confetti from 'canvas-confetti'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, FileText, Loader2, Play, RefreshCcw, Star } from 'lucide-react'
import type { Order } from '@/types/marketplace'
import { useAppStore } from '@/store/app-store'
import { useChannels } from '@/lib/use-channels'
import { ChannelCard } from '@/components/shop/SocialFamilySection'
import { playFx } from '@/lib/sound-fx'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const POLL_INTERVAL_MS = 3000
const POLL_MAX_TICKS = 60 // 60 × 3s = 3 minutes

export function ThankYouView({ orderId }: { orderId: string | null }) {
  const navigate = useAppStore((s) => s.navigate)

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(Boolean(orderId))
  const [error, setError] = useState(false)
  // T-V Feature C — demo-mode watch link stashed by the checkout dialog
  // (real buyers open the link straight from the email). Read once in the
  // state initializer (this view never renders on the server).
  const [watchUrl, setWatchUrl] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem('sdh_watch_token')
    } catch {
      return null
    }
  })
  // Layer 2 — the buyer's verified-review invite stashed by the checkout
  // dialog when the payment response carried the order token (demo paths);
  // otherwise the delivery email carries the rate link.
  const [rateUrl, setRateUrl] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem('sdh_rate_url')
    } catch {
      return null
    }
  })

  // Gold celebration burst on mount
  useEffect(() => {
    confetti({
      particleCount: 140,
      spread: 85,
      origin: { y: 0.45 },
      colors: ['#E5B842', '#FAE8A7', '#FFB347', '#00F0FF'],
      disableForReducedMotion: true,
    })
    playFx('sparkle')
  }, [])

  const fetchOrder = useCallback(
    async (silent = false) => {
      if (!orderId) return
      if (!silent) setLoading(true)
      try {
        const res = await fetch(`/api/orders/${orderId}`)
        if (!res.ok) {
          if (!silent) setError(true)
          return
        }
        const data = (await res.json()) as { order?: Order }
        if (data.order) {
          setOrder(data.order)
          setError(false)
        } else if (!silent) {
          setError(true)
        }
      } catch {
        if (!silent) setError(true)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [orderId],
  )

  useEffect(() => {
    void fetchOrder()
  }, [fetchOrder])

  // Poll while payment is pending (max 3 minutes)
  useEffect(() => {
    if (!order || order.status !== 'pending') return
    let ticks = 0
    const t = setInterval(() => {
      ticks += 1
      if (ticks > POLL_MAX_TICKS) {
        clearInterval(t)
        return
      }
      void fetchOrder(true)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [order, order?.status, fetchOrder])

  const firstName = order?.customerName.trim().split(/\s+/)[0] || 'friend'

  const backToShop = () => {
    playFx('whoosh')
    navigate('shop', order?.product?.zone ? { zone: order.product.zone } : undefined)
  }

  const card = 'glass mx-auto w-full max-w-lg rounded-3xl p-6 text-center md:p-10'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 md:px-6">
      {!orderId ? (
        <div className={cn(card, 'flex flex-col items-center gap-4')}>
          <span className="text-6xl" aria-hidden="true">
            🧾
          </span>
          <h1 className="text-2xl font-bold md:text-3xl">No order reference here</h1>
          <p className="text-sm text-muted-foreground">
            If you just paid, your receipt is on its way to your email — or hop back to the shop and keep exploring.
          </p>
          <Button onClick={backToShop} className="h-11 min-w-[170px]">
            Back to shop
          </Button>
        </div>
      ) : loading ? (
        <div className={cn(card, 'flex flex-col items-center gap-4')} role="status" aria-live="polite">
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Fetching your order…</p>
        </div>
      ) : error ? (
        <div className={cn(card, 'flex flex-col items-center gap-4')}>
          <span className="text-5xl" aria-hidden="true">
            📡
          </span>
          <h1 className="text-xl font-bold">We couldn&apos;t load this order</h1>
          <p className="text-sm text-muted-foreground">The order service didn&apos;t respond. Give it another go.</p>
          <Button onClick={() => void fetchOrder()} className="h-11 min-w-[150px]">
            <RefreshCcw className="size-4" aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : order ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className={cn(card, 'flex flex-col items-center gap-4')}
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Order {order.id}
          </p>

          {order.status === 'paid' && (
            <>
              <motion.div
                initial={{ scale: 0, rotate: -18 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="flex size-20 items-center justify-center rounded-full bg-emerald-500 shadow-[0_10px_30px_rgba(16,185,129,0.45)]"
                aria-hidden="true"
              >
                <Check className="size-10 text-white" strokeWidth={3} />
              </motion.div>

              <h1 className="font-baloo text-2xl font-extrabold md:text-3xl">🎉 Thank you, {firstName}!</h1>
              <p className="text-sm font-semibold text-foreground">
                {order.product?.title ?? 'Your order'} is on its way.
              </p>
              <p className="text-sm text-muted-foreground">
                Your file was emailed to <span className="font-semibold text-foreground">{order.customerEmail}</span>.
                Link valid 48h / 5 downloads — use the link from your email to download anytime.
              </p>

              {order.emailSent === false && (
                <p
                  role="status"
                  className="rounded-lg border-2 border-amber-400 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900"
                >
                  🧪 DEMO MODE — email delivery activates once RESEND_API_KEY is configured. Your download was shown
                  right after payment.
                </p>
              )}

              {/* T-V Feature C — protected watch page: open it right here */}
              {order.product?.deliveryMode === 'watch' &&
                (watchUrl ? (
                  <a
                    href={watchUrl}
                    className="inline-flex h-12 min-w-[200px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-amber-400 text-base font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)] transition-transform hover:scale-[1.02]"
                  >
                    <Play className="size-5" aria-hidden="true" fill="currentColor" /> Watch now
                  </a>
                ) : (
                  <p className="rounded-lg border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
                    🎬 Your protected watch link is in your email — open it to start watching.
                  </p>
                ))}

              {/* Layer 2 — verified review invite (order token known post-payment;
                  otherwise the delivery email carries the same link). */}
              {rateUrl && (
                <a
                  href={rateUrl}
                  className="inline-flex h-11 min-w-[200px] items-center justify-center gap-2 rounded-xl border-2 border-amber-400/70 bg-amber-100 px-4 text-sm font-bold text-amber-900 transition-transform hover:scale-[1.02] dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  <Star className="size-4" aria-hidden="true" fill="currentColor" /> Rate your download
                </a>
              )}

              {/* Invoice — PDF in the currency the customer actually paid in.
                  Same-origin GET; the claim cookie authorises it like the
                  order-status poll (no token in the URL). */}
              <a
                href={`/api/orders/${order.id}/invoice`}
                className="inline-flex h-11 min-w-[200px] items-center justify-center gap-2 rounded-xl border-2 border-white/25 bg-white/60 px-4 text-sm font-bold text-foreground transition-transform hover:scale-[1.02] dark:border-white/20 dark:bg-white/10"
              >
                <FileText className="size-4" aria-hidden="true" /> Download invoice (PDF)
              </a>
            </>
          )}

          {order.status === 'pending' && (
            <>
              <div
                className="flex size-20 items-center justify-center rounded-full border-4 border-primary/30"
                aria-hidden="true"
              >
                <Loader2 className="size-9 animate-spin text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Waiting for payment confirmation…</h1>
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                We&apos;re watching for your UPI payment. This usually lands within a minute.
              </p>
              <p className="rounded-lg border border-dashed border-amber-400/70 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                🧪 Demo mode: return to your payment dialog to complete the simulated payment.
              </p>
              <Button variant="outline" onClick={() => void fetchOrder()} className="h-11 min-w-[170px]">
                <RefreshCcw className="size-4" aria-hidden="true" /> Refresh status
              </Button>
            </>
          )}

          {(order.status === 'failed' || order.status === 'revoked' || order.status === 'refunded') && (
            <>
              <div
                className="flex size-20 items-center justify-center rounded-full bg-amber-400/20"
                aria-hidden="true"
              >
                <AlertTriangle className="size-9 text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold">
                {order.status === 'revoked'
                  ? 'This download was revoked'
                  : order.status === 'refunded'
                    ? 'This order was refunded'
                    : "Payment didn't go through"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {order.status === 'revoked'
                  ? 'Access to this file was revoked. If you believe this is a mistake, we can fix it.'
                  : order.status === 'refunded'
                    ? 'The payment was refunded and download access has been closed. Contact support if this is unexpected.'
                    : 'The payment could not be completed. Nothing was charged beyond what your bank shows.'}
              </p>
              <p className="rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
                Need help? Contact support and we&apos;ll sort it out within a day.
              </p>
            </>
          )}

          <Button onClick={backToShop} className="mt-2 h-11 min-w-[180px]" variant={order.status === 'paid' ? 'default' : 'outline'}>
            Continue shopping
          </Button>
        </motion.div>
      ) : null}

      {/* T-V Feature A — "Subscribe for more" (zone of the bought product;
          hidden entirely when that zone has no channels). */}
      {order?.status === 'paid' && order.product?.zone && <SubscribeForMore zone={order.product.zone} />}
    </div>
  )
}

/** Small social-media-family strip below the receipt card. */
function SubscribeForMore({ zone }: { zone: 'kids' | 'creator' }) {
  const channels = useChannels(zone)
  if (channels.length === 0) return null
  return (
    <section aria-labelledby="social-subscribe-more" className="mx-auto mt-8 w-full max-w-lg">
      <div className="glass rounded-3xl p-5">
        <h2 id="social-subscribe-more" className="font-baloo text-lg font-extrabold text-foreground">
          Subscribe for more ✨
        </h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Free videos from our {zone === 'kids' ? 'Kids' : 'Creator'} channels — new uploads regularly.
        </p>
        <div className="grid gap-3">
          {channels.slice(0, 3).map((c) => (
            <ChannelCard key={c.id} channel={c} zone={zone} compact />
          ))}
        </div>
      </div>
    </section>
  )
}
