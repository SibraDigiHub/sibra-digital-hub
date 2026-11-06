'use client'

// ═══════════════════════════════════════════════════════════
// InstantDownloadDialog — ⚡ instant-delivery checkout (single
// gateway §5.2). 3-step state machine: form → pay → success.
//
//   India (server-decided)  → Razorpay Standard Checkout (INR);
//                             UPI demo QR in the key-less demo env.
//   Everywhere else         → Razorpay Standard Checkout in the
//                             configured foreign currency (flag on).
//
// The gateway/currency/amount are ALWAYS the server's quote —
// the dialog only echoes them. Success is shown ONLY after the
// server confirms PAID (never from a browser callback alone).
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import QRCode from 'qrcode'
import { motion } from 'framer-motion'
import { Check, Copy, Loader2 } from 'lucide-react'
import type { Product } from '@/types/marketplace'
import { formatMoney } from '@/types/marketplace'
import { platformMeta } from '@/lib/platforms'
import { playFx } from '@/lib/sound-fx'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { COUNTRIES, countryName } from '@/lib/countries'
import {
  createCheckout,
  fetchGeoCountry,
  fetchQuote,
  loadRazorpayCheckout,
  type Quote,
  type RazorpayCheckoutOptions,
  type RazorpayCheckoutInstance,
  type RazorpayHandlerResponse,
} from '@/lib/payments'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Step = 'form' | 'upi' | 'razorpay' | 'success'

/** Sub-states of the Razorpay checkout step (§5.2). */
type RazorpayStage = 'opening' | 'waiting' | 'dismissed' | 'failed' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const POLL_INTERVAL_MS = 3000
const POLL_MAX_TICKS = 100 // 100 × 3s = 5 minutes
/** Consecutive failed status polls before the dialog surfaces an error
 *  instead of silently spinning forever (e.g. proxy/network breakdown). */
const POLL_FAIL_LIMIT = 10

const QUOTE_HINTS: Record<string, string> = {
  razorpay: 'Pay {amount} securely via Razorpay Checkout.',
}

function quoteLine(quote: Quote): string {
  return (QUOTE_HINTS[quote.gateway] ?? 'Pay {amount}.').replace('{amount}', quote.display)
}

export function InstantDownloadDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()

  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [country, setCountry] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; country?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  // §8: the quote (gateway + exact total) — server-authoritative.
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [orderId, setOrderId] = useState<string | null>(null)
  const [upiId, setUpiId] = useState('')
  const [upiPayeeName, setUpiPayeeName] = useState('')
  const [amountInr, setAmountInr] = useState<number>(product.priceInr)
  const [displayAmount, setDisplayAmount] = useState('')
  // Server-issued Standard Checkout options (same Razorpay Order is
  // re-opened on retry — never a second payable session).
  const [rzpOptions, setRzpOptions] = useState<RazorpayCheckoutOptions | null>(null)
  const [rzpStage, setRzpStage] = useState<RazorpayStage>('opening')
  // Re-open attempt counter — the retry button bumps it to re-run the effect.
  const [rzpAttempt, setRzpAttempt] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState('')
  // Re-audit honesty fix: a 202 PENDING_REVIEW capture is NOT a received
  // payment — the success step must say "processing", not "received".
  const [pendingReview, setPendingReview] = useState(false)
  // T-V Feature C — watch-mode orders: demo success shows the on-site
  // watch button; the token is stashed for the thank-you page too.
  const [watchUrl, setWatchUrl] = useState('')
  const [emailDemo, setEmailDemo] = useState(false)
  const [paidEmail, setPaidEmail] = useState('')

  const [qrUrl, setQrUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [pollTicks, setPollTicks] = useState(0)
  const [pollStalled, setPollStalled] = useState(false)
  // P6: the gateway refused the card (RAZORPAY_BLOCK_INTERNATIONAL_CARDS) —
  // the dialog must SAY so instead of polling a pending order forever.
  const [paymentBlocked, setPaymentBlocked] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const idempotencyKey = useRef<string>('')
  // One-shot setTimeout handles inside the checkout step (e.g. the gateway
  // pointer-events unlock) — cleared on unmount so nothing fires post-close.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // The live checkout instance — closed on unmount so a dismiss during
  // navigation never leaves a dangling modal.
  const rzpInstance = useRef<RazorpayCheckoutInstance | null>(null)

  const money = formatMoney(product.priceUsd, product.priceInr)
  const deliverableName = product.deliverableName ?? 'your file'

  const goToSuccess = useCallback(() => {
    setStep('success')
    playFx('sparkle')
    confetti({ particleCount: 130, spread: 90, origin: { x: 0.5, y: 0.45 }, disableForReducedMotion: true })
  }, [])

  // ── Quote follows the confirmed country (§8) — fetched from the
  // change handler / geo pre-select, never from a render-phase effect.
  const loadQuote = useCallback(
    (countryCode: string) => {
      if (!countryCode) return
      setQuoteLoading(true)
      setQuoteError(null)
      fetchQuote(product.id, countryCode)
        .then((r) => {
          if (r.ok) setQuote(r.quote)
          else setQuoteError(r.error)
        })
        .catch(() => setQuoteError('Could not fetch the price right now — please try again.'))
        .finally(() => setQuoteLoading(false))
    },
    [product.id],
  )

  // ── Reset the machine shortly after the dialog closes ────
  useEffect(() => {
    if (open) {
      // §8: one Idempotency-Key per dialog-open (retries reuse it).
      idempotencyKey.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sdh-${Date.now()}-${Math.random().toString(36).slice(2)}`
      // Geo-IP only PRE-SELECTS the default — the customer confirms it (§2.2).
      void fetchGeoCountry().then((hint) => {
        if (!hint || country) return
        setCountry(hint)
        loadQuote(hint)
      })
      return
    }
    const t = setTimeout(() => {
      setStep('form')
      setName('')
      setEmail('')
      setCountry('')
      setErrors({})
      setSubmitting(false)
      setQuote(null)
      setQuoteLoading(false)
      setQuoteError(null)
      setOrderId(null)
      setUpiId('')
      setUpiPayeeName('')
      setAmountInr(product.priceInr)
      setDisplayAmount('')
      setRzpOptions(null)
      setRzpStage('opening')
      setRzpAttempt(0)
      setDownloadUrl('')
      setWatchUrl('')
      setEmailDemo(false)
      setPaidEmail('')
      setPendingReview(false)
      setQrUrl('')
      setCopied(false)
      setPollTicks(0)
      setPaymentBlocked(false)
    }, 450)
    return () => clearTimeout(t)
  }, [open, product.priceInr, loadQuote])

  // Stop polling whenever the step leaves 'razorpay' or dialog closes
  useEffect(() => {
    if (step !== 'razorpay' && pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [step])

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    },
    [],
  )

  // ── QR generation for the demo UPI step ──────────────────
  useEffect(() => {
    if (step !== 'upi' || !upiId) return
    let live = true
    const upiString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiPayeeName)}&am=${amountInr}&cu=INR&tn=${encodeURIComponent(`SDH ${product.slug}`)}`
    void QRCode.toDataURL(upiString, { width: 220, margin: 1 })
      .then((url) => {
        if (live) setQrUrl(url)
      })
      .catch(() => {
        if (live) setQrUrl('')
      })
    return () => {
      live = false
    }
  }, [step, upiId, upiPayeeName, amountInr, product.slug])

  // ── Razorpay mode: poll order status every 3s (max 5 min) ─
    const startPolling = useCallback((id: string) => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      let ticks = 0
      let failures = 0
      setPollStalled(false)
      pollTimer.current = setInterval(async () => {
        ticks += 1
        setPollTicks(ticks)
        if (ticks > POLL_MAX_TICKS) {
          if (pollTimer.current) clearInterval(pollTimer.current)
          pollTimer.current = null
          return
        }
        try {
          const res = await fetch(`/api/orders/${id}/status`)
          if (res.ok) {
            const data = (await res.json()) as { order?: { status: string; customerEmail?: string; paymentBlocked?: boolean } }
            if (data.order?.paymentBlocked) {
              // P6: the payment was refused (international card on an IN order).
              // Stop polling; the step renders the friendly blocked message.
              if (pollTimer.current) clearInterval(pollTimer.current)
              pollTimer.current = null
              setPaymentBlocked(true)
              playFx('error')
              return
            }
            if (data.order?.status === 'paid') {
              if (pollTimer.current) clearInterval(pollTimer.current)
              pollTimer.current = null
              setPaidEmail(data.order.customerEmail ?? email.trim())
              goToSuccess()
              return
            }
            failures = 0
          } else {
            failures += 1
          }
        } catch {
          // transient network error — tolerated up to POLL_FAIL_LIMIT,
          // then the dialog must SAY so instead of spinning silently
          failures += 1
        }
        if (failures >= POLL_FAIL_LIMIT) {
          if (pollTimer.current) clearInterval(pollTimer.current)
          pollTimer.current = null
          setPollStalled(true)
          playFx('error')
          toast({
            title: 'Confirmation is taking longer than usual',
            description: 'We could not reach the payment service to confirm. If you already paid, the delivery email will still arrive — you can also close and reopen this dialog.',
          })
        }
      }, POLL_INTERVAL_MS)
  }, [])
  /** Forward the checkout callback to the server — IT decides the truth. */
  const verifyPayment = useCallback(
    async (response: RazorpayHandlerResponse) => {
      setRzpStage('waiting')
      try {
        const res = await fetch('/api/razorpay/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
            orderId,
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; order?: { customerEmail?: string; status?: string }; error?: string }
        if (res.ok && data.ok) {
          // Verified + fulfilled — the status poll confirms PAID and flips to
          // the success step (single source of truth, no double celebration).
          setPaidEmail(data.order?.customerEmail ?? email.trim())
          if (orderId) startPolling(orderId)
          return
        }
        if (res.status === 409) {
          // Not captured yet (authorized/pending) — keep waiting; webhook or
          // reconcile completes it and the poll still sees PAID.
          if (orderId) startPolling(orderId)
          return
        }
        playFx('error')
        setRzpStage('error')
        toast({
          title: 'Payment could not be verified',
          description: data.error ?? 'Your payment could not be confirmed automatically. If you were charged, the delivery email will still arrive.',
        })
      } catch {
        playFx('error')
        setRzpStage('error')
        toast({ title: 'Network hiccup', description: 'We could not confirm the payment. Check your connection — if you were charged, the delivery email will still arrive.' })
      }
    },
    [email, orderId, toast],
  )

  // ── Razorpay Standard Checkout (§5.2) — opened once the step renders ──
  // The SAME server-issued Razorpay Order is (re-)opened on retry — a
  // dismissed modal or a failed verify never creates a second chargeable
  // session. Success is confirmed by POST /api/razorpay/verify and then the
  // status poll (the browser callback alone is never proof of payment).
  useEffect(() => {
    if (step !== 'razorpay' || !rzpOptions || !orderId) return
    let live = true
    let cancelled = false
    const openCheckout = async () => {
      setRzpStage('opening')
      const ok = await loadRazorpayCheckout()
      if (!live || cancelled) return
      if (!ok || !window.Razorpay) {
        // Script blocked or timed out — surface a friendly fallback instead
        // of an endless spinner (§2.8).
        setRzpStage('failed')
        return
      }
      try {
        // checkout.js expects ITS OWN names (key/order_id/prefill) — map
        // them from the server echo (keyId/orderId/prefillName/prefillEmail).
        // Passing the echo shape as-is throws "No key passed".
        const checkout = new window.Razorpay({
          key: rzpOptions.keyId,
          order_id: rzpOptions.orderId,
          amount: rzpOptions.amount,
          currency: rzpOptions.currency,
          name: rzpOptions.name,
          description: rzpOptions.description,
          prefill: { name: rzpOptions.prefillName, email: rzpOptions.prefillEmail },
          notes: { orderRef: rzpOptions.orderRef },
          theme: { color: '#10b981' },
          modal: {
            ondismiss: () => {
              if (!live || cancelled) return
              // Customer closed the modal — the order stays payable; retry
              // re-opens the SAME Razorpay Order (no duplicate session).
              setRzpStage('dismissed')
              playFx('error')
            },
          },
          handler: (response: RazorpayHandlerResponse) => {
            if (!live || cancelled) return
            void verifyPayment(response)
          },
        })
        rzpInstance.current = checkout
        // Payment-level failures inside the modal (declined card, network):
        // keep the dialog in the waiting/error state — the modal itself
        // shows the error and stays open for a retry within Razorpay UI.
        checkout.on?.('payment.failed', () => {
          if (!live || cancelled) return
          setRzpStage('error')
          playFx('error')
        })
        checkout.open()
        // Radix's dialog lock sets `pointer-events: none` on <body> while our
        // dialog is open; the gateway sheet is a body-level child and INHERITS
        // it — the sheet then renders but ignores every click. Re-enable
        // pointer events on Razorpay's container (created synchronously by
        // open(); the retry covers the SDK's async container swap). The
        // container is removed by the SDK on close, so no cleanup is needed.
        const unlockSheet = () =>
          document.querySelector<HTMLElement>('.razorpay-container')?.style.setProperty('pointer-events', 'auto')
        unlockSheet()
        const unlockTimer = setTimeout(unlockSheet, 250)
        timersRef.current.push(unlockTimer)
      } catch {
        if (!live || cancelled) return
        setRzpStage('failed')
      }
    }
    void openCheckout()
    return () => {
      live = false
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      try {
        rzpInstance.current?.close()
      } catch {
        /* checkout cleanup is best-effort */
      }
      rzpInstance.current = null
    }
  }, [step, rzpOptions, orderId, rzpAttempt, verifyPayment])

  // ── Step 1 → create order (server picks the gateway) ─────
  const submitForm = async () => {
    const nextErrors: { name?: string; email?: string; country?: string } = {}
    if (name.trim().length < 2) nextErrors.name = 'Please enter your name (at least 2 characters).'
    if (!EMAIL_RE.test(email.trim())) nextErrors.email = "That email doesn't look right — please check it."
    if (!country) nextErrors.country = 'Please confirm your billing country.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      playFx('error')
      return
    }

    setSubmitting(true)
    try {
      const { res, data } = await createCheckout(
        {
          productId: product.id,
          customerName: name.trim(),
          customerEmail: email.trim(),
          country,
          consent: true,
        },
        idempotencyKey.current,
      )
      if (!res.ok || !data.order) {
        playFx('error')
        toast({
          title: 'Could not start checkout',
          description: data.error ?? 'Something went wrong creating your order. Please try again.',
        })
        return
      }
      setOrderId(data.order.id)
      setDisplayAmount(data.display ?? '')
      if (data.paymentMode === 'razorpay' && data.razorpay) {
        setRzpOptions(data.razorpay)
        setRzpStage('opening')
        setStep('razorpay')
      } else {
        // Demo environment (no Razorpay keys): the India UPI simulation.
        setUpiId(data.upiId ?? '')
        setUpiPayeeName(data.upiPayeeName ?? 'Sibra Digital Hub')
        setAmountInr((data.amountMinor ?? Math.round(product.priceInr * 100)) / 100)
        setStep('upi')
      }
    } catch {
      playFx('error')
      toast({ title: 'Network hiccup', description: 'We could not reach the checkout. Check your connection and retry.' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Demo mode: simulate a successful UPI payment ─────────
  const simulatePayment = async () => {
    if (!orderId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/demo-pay`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        order?: { customerEmail: string }
        downloadUrl?: string
        watchUrl?: string
        rateUrl?: string
        emailDemo?: boolean
        error?: string
      }
      if (!res.ok) {
        playFx('error')
        toast({
          title: 'Demo payment failed',
          description: data.error ?? 'The simulated payment was rejected. Please try again.',
        })
        return
      }
      setDownloadUrl(data.downloadUrl ?? '')
      setWatchUrl(data.watchUrl ?? '')
      stashWatchToken(data.watchUrl ?? '')
      stashRateUrl(data.rateUrl ?? '')
      setEmailDemo(data.emailDemo ?? false)
      setPaidEmail(data.order?.customerEmail ?? email.trim())
      goToSuccess()
    } catch {
      playFx('error')
      toast({ title: 'Network hiccup', description: 'We could not complete the demo payment. Please retry.' })
    } finally {
      setSubmitting(false)
    }
  }

  const stashWatchToken = (url: string) => {
    try {
      if (url) window.sessionStorage.setItem('sdh_watch_token', url)
      else window.sessionStorage.removeItem('sdh_watch_token')
    } catch {
      /* private mode — thank-you falls back to the email message */
    }
  }

  // Layer 2 — keep the verified-review invite (rate page) for the thank-you
  // view; the demo-pay/capture responses carry it alongside the watch link.
  const stashRateUrl = (url: string) => {
    try {
      if (url) window.sessionStorage.setItem('sdh_rate_url', url)
      else window.sessionStorage.removeItem('sdh_rate_url')
    } catch {
      /* private mode — thank-you falls back to the email message */
    }
  }

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(upiId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast({ title: 'UPI ID copied 📋', description: 'Paste it into GPay, PhonePe or Paytm.' })
    } catch {
      toast({ title: 'Copy failed', description: 'Please copy the UPI ID manually.' })
    }
  }

  const marketplaceHint = product.platformLinks.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <div className="max-h-[85dvh] overflow-y-auto nice-scroll pr-1">
          {step === 'form' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-left">
                  <span className="line-clamp-2">⚡ Instant Download — {product.title}</span>
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-primary-foreground">
                    {quote?.display ?? money.inr}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-left">
                  Pay in your local currency, get your file by email in seconds. No account needed.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-2 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="instant-name">Your name</Label>
                  <Input
                    id="instant-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    autoComplete="name"
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? 'instant-name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="instant-name-error" role="alert" className="text-xs font-medium text-destructive">
                      {errors.name}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="instant-email">Email address</Label>
                  <Input
                    id="instant-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    inputMode="email"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? 'instant-email-error' : undefined}
                  />
                  {errors.email && (
                    <p id="instant-email-error" role="alert" className="text-xs font-medium text-destructive">
                      {errors.email}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="instant-country">Billing country</Label>
                  <select
                    id="instant-country"
                    value={country}
                    onChange={(e) => {
                      setCountry(e.target.value)
                      loadQuote(e.target.value)
                    }}
                    aria-invalid={Boolean(errors.country)}
                    aria-describedby={errors.country ? 'instant-country-error' : 'instant-country-note'}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="" disabled>
                      Select your country…
                    </option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p id="instant-country-note" className="text-xs text-muted-foreground">
                    We use the country you confirm to choose the payment method.
                  </p>
                  {errors.country && (
                    <p id="instant-country-error" role="alert" className="text-xs font-medium text-destructive">
                      {errors.country}
                    </p>
                  )}
                </div>

                {/* §8 gateway + exact total line (server quote) */}
                <div aria-live="polite" className="min-h-[34px]">
                  {quoteLoading && (
                    <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Fetching your total…
                    </p>
                  )}
                  {!quoteLoading && quote && (
                    <p className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
                      {quoteLine(quote)}{' '}
                      <span className="font-normal text-muted-foreground">
                        Total {quote.display} · {quote.currency}
                      </span>
                    </p>
                  )}
                  {!quoteLoading && quoteError && (
                    <div className="rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900">
                      <p>{quoteError}</p>
                      {marketplaceHint && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {product.platformLinks.slice(0, 4).map((pl, i) => (
                            <a
                              key={`${pl.platform}-${pl.url}-${i}`}
                              href={pl.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-amber-900 underline-offset-2 hover:underline"
                            >
                              {platformMeta(pl.platform).short}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  onClick={() => void submitForm()}
                  disabled={submitting || quoteLoading || Boolean(quoteError)}
                  className="h-12 w-full bg-gradient-to-r from-emerald-500 to-amber-400 text-base font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)] hover:from-emerald-600 hover:to-amber-500"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" /> Creating your order…
                    </>
                  ) : (
                    'Continue to payment →'
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  You&apos;ll receive your file at this email within seconds of payment.
                </p>
              </div>
            </>
          )}

          {step === 'upi' && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-left">Scan &amp; Pay {formatMoney(0, amountInr).inr}</DialogTitle>
                <DialogDescription className="text-left">
                  Order <span className="font-mono text-[11px]">{orderId}</span> · GPay, PhonePe, Paytm or BHIM
                </DialogDescription>
              </DialogHeader>

              <div
                role="status"
                className="mt-1 rounded-lg border-2 border-amber-400 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900"
              >
                🧪 DEMO MODE — Razorpay keys not configured. Payment is simulated.
              </div>

              <div className="mt-4 flex flex-col items-center gap-3">
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt={`UPI QR code to pay ₹${Math.round(amountInr)} for ${product.title}`}
                    width={220}
                    height={220}
                    className="rounded-xl border-2 border-amber-300 bg-white p-2"
                  />
                ) : (
                  <div className="flex h-[220px] w-[220px] items-center justify-center rounded-xl border-2 border-dashed border-amber-300 bg-white/60">
                    <Loader2 className="animate-spin text-amber-500" aria-hidden="true" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Scan with any UPI app to pay {formatMoney(0, amountInr).inr}</p>

                <div className="flex w-full items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2.5 font-mono text-sm">
                    {upiId}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void copyUpi()}
                    aria-label="Copy UPI ID to clipboard"
                    className="size-11 shrink-0"
                  >
                    {copied ? <Check className="text-emerald-600" aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </Button>
                </div>

                <Button
                  type="button"
                  onClick={() => void simulatePayment()}
                  disabled={submitting}
                  className="h-12 w-full bg-gradient-to-r from-emerald-500 to-amber-400 text-base font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)]"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" /> Confirming…
                    </>
                  ) : (
                    '✅ Simulate Payment Success (Demo)'
                  )}
                </Button>
              </div>
            </>
          )}

          {step === 'razorpay' && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-left">Complete your payment</DialogTitle>
                <DialogDescription className="text-left">
                  Order <span className="font-mono text-[11px]">{orderId}</span>
                  {displayAmount ? <> · total {displayAmount}</> : null}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-2 flex flex-col items-center gap-4">
                {(rzpStage === 'opening' || rzpStage === 'waiting') && (
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                      {rzpStage === 'opening' ? 'Opening secure Razorpay Checkout…' : 'Confirming your payment…'}
                    </span>
                    {rzpStage === 'waiting' && <span className="text-xs">This takes a moment — don&apos;t close this dialog.</span>}
                  </div>
                )}
                {rzpStage === 'dismissed' && (
                  <div className="w-full rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-3 text-sm text-amber-900" role="status">
                    <p className="font-semibold">Payment window closed.</p>
                    <p className="mt-1 text-xs">No charge was made. You can reopen the checkout and try again whenever you like.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 h-9 w-full border-amber-500/60 text-amber-900 hover:bg-amber-200"
                      onClick={() => setRzpAttempt((n) => n + 1)}
                    >
                      Reopen the payment window
                    </Button>
                  </div>
                )}
                {rzpStage === 'failed' && (
                  <div className="w-full rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-3 text-sm text-amber-900" role="alert">
                    <p className="font-semibold">The payment window couldn’t load.</p>
                    <p className="mt-1 text-xs">An ad-blocker or network filter may be blocking Razorpay Checkout. You can retry, or use one of the “Buy on …” marketplace buttons on the product page instead.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 h-9 w-full border-amber-500/60 text-amber-900 hover:bg-amber-200"
                      onClick={() => setRzpAttempt((n) => n + 1)}
                    >
                      Retry the payment window
                    </Button>
                  </div>
                )}
                {rzpStage === 'error' && (
                  <div className="w-full rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-3 text-sm text-amber-900" role="alert">
                    <p className="font-semibold">The payment didn’t go through.</p>
                    <p className="mt-1 text-xs">The bank declined it or it was interrupted — no download was lost. You can retry the same order, or use one of the “Buy on …” marketplace buttons on the product page.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 h-9 w-full border-amber-500/60 text-amber-900 hover:bg-amber-200"
                      onClick={() => setRzpAttempt((n) => n + 1)}
                    >
                      Retry the payment
                    </Button>
                  </div>
                )}
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                    Waiting for payment confirmation…
                  </span>
                  {pollTicks > POLL_MAX_TICKS && (
                    <span className="text-xs">Still processing — you&apos;ll get an email the moment your payment lands.</span>
                  )}
                  {pollStalled && (
                    <span className="text-xs">Payment confirmation is stuck right now — if you already paid, the delivery email will still arrive. You can close this dialog and try again.</span>
                  )}
                </div>
                {paymentBlocked && (
                  <div className="w-full rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-3 text-sm text-amber-900" role="alert">
                    <p className="font-semibold">Your card payment couldn’t be accepted for this order.</p>
                    <p className="mt-1 text-xs">
                      This order is billed in India (₹), and non-Indian cards are not accepted on it — no money was taken. Please try again with UPI or net banking in the
                      secure checkout, or use one of the “Buy on …” marketplace buttons on the product page.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 h-9 w-full border-amber-500/60 text-amber-900 hover:bg-amber-200"
                      onClick={() => {
                        setPaymentBlocked(false)
                        setRzpAttempt((n) => n + 1)
                      }}
                    >
                      Retry the payment
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'success' && (
            <div
              className="flex flex-col items-center gap-4 py-2 text-center"
              role="status"
              aria-live="polite"
            >
              {/* The success step replaces the form header — keep the dialog's
                  accessible name (Radix warns without a DialogTitle here). */}
              <DialogTitle className="sr-only">{pendingReview ? 'Payment processing' : 'Payment received'}</DialogTitle>
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="flex size-20 items-center justify-center rounded-full bg-emerald-500 shadow-[0_10px_30px_rgba(16,185,129,0.45)]"
                aria-hidden="true"
              >
                <Check className="size-10 text-white" strokeWidth={3} />
              </motion.div>

              <h2 className="font-baloo text-2xl font-extrabold text-foreground">
                {pendingReview ? 'Payment processing ⏳' : 'Payment received! 🎉'}
              </h2>
              {pendingReview ? (
                <p className="text-sm text-muted-foreground">
                  The payment is still processing — we&apos;ll email your secure link to{' '}
                  <span className="font-semibold text-foreground">{paidEmail}</span> the moment it clears. No action needed.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sent to <span className="font-semibold text-foreground">{paidEmail}</span> (check inbox &amp; spam).
                </p>
              )}

              {emailDemo && (
                <p className="rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900">
                  Demo mode: email delivery activates when RESEND_API_KEY is set.
                </p>
              )}

              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  className={cn(
                    'inline-flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-amber-400',
                    'text-base font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)] transition-transform hover:scale-[1.02]',
                  )}
                >
                  ⬇️ Download {deliverableName}
                </a>
              ) : watchUrl ? (
                <a
                  href={watchUrl}
                  className={cn(
                    'inline-flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-amber-400',
                    'text-base font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)] transition-transform hover:scale-[1.02]',
                  )}
                >
                  ▶ Watch now
                </a>
              ) : (
                <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Check your email for the secure link (valid 48h).
                </p>
              )}

              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
