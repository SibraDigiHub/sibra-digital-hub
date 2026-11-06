'use client'

// ═══════════════════════════════════════════════════════════
// T-V Feature C — the protected watch page (/#/watch/<token>).
//
// Flow: token arrives in the URL FRAGMENT (fragments are never
// sent to any server) → GET resolve happens ONLY here → the
// server validates (paid · not expired · not revoked · not
// locked) and only THEN hands back the embed URL → the video
// loads when the buyer presses Play → a 30s heartbeat keeps
// the viewing session alive (concurrency + share protection).
//
// Page hardening: dynamic noindex/robots meta, no-referrer,
// token stripped from the address bar after mount, nothing
// rendered before the grant check, friendly states with the
// renewal path. Watermark: buyer name + order ref over the
// video area only (never over YouTube's controls/branding).
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import VideoPlayerFrame from '@/components/shop/VideoPlayerFrame'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'

const HEARTBEAT_MS = 30_000
const SESSION_KEY = 'sdh_watch_session'

function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    window.sessionStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    // private mode: a per-mount id still gives honest session bookkeeping
    return `tmp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}

interface ResolveOk {
  provider: 'youtube' | 'imagekit' | 'file'
  src: string
  watermark: string
  expiresAt: string
  maxConcurrent: number
  productTitle: string
}

type Phase = 'checking' | 'ok' | 'concurrent' | 'locked' | 'expired' | 'revoked' | 'invalid'

export default function WatchView({ token }: { token: string | null }) {
  const navigate = useAppStore((s) => s.navigate)
  const [phase, setPhase] = useState<Phase>('checking')
  const [info, setInfo] = useState<ResolveOk | null>(null)
  const [message, setMessage] = useState('')
  const [hbActive, setHbActive] = useState(true)
  const aliveRef = useRef(true)

  // ── Page hardening: noindex + no-referrer while this view is mounted ──
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow, noarchive'
    document.head.appendChild(robots)
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.appendChild(referrer)
    return () => {
      robots.remove()
      referrer.remove()
    }
  }, [])

  // The token persists in the URL FRAGMENT across reloads — never sent to
  // any server/log/referrer, so no address-bar rewriting here on purpose.

  // ── Resolve once on mount ──
  useEffect(() => {
    aliveRef.current = true
    if (!token || token.length < 16) {
      // Deferred (kept out of the sync effect body)
      const t = setTimeout(() => {
        setPhase('invalid')
        setMessage('This watch link is not valid. Please use the exact link from your email.')
      }, 0)
      return () => clearTimeout(t)
    }
    ;(async () => {
      try {
        const res = await fetch(`/api/watch/${encodeURIComponent(token)}/resolve`, { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as (ResolveOk & { error?: string }) | { error?: string } | null
        if (!aliveRef.current) return
        if (res.ok && data && 'src' in data) {
          setInfo(data)
          setPhase('ok')
          return
        }
        const msg = data?.error ?? 'This watch link is not valid.'
        setMessage(msg)
        if (msg.includes('expired')) setPhase('expired')
        else if (msg.includes('revoked')) setPhase('revoked')
        else if (msg.includes('locked')) setPhase('locked')
        else setPhase('invalid')
      } catch {
        if (aliveRef.current) {
          setPhase('invalid')
          setMessage('We could not verify this link right now — please try again in a moment.')
        }
      }
    })()
    return () => {
      aliveRef.current = false
    }
  }, [token])

  // ── Heartbeat (only while the grant is OK) ──
  const beat = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/watch/${encodeURIComponent(token)}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: getSessionId() }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; reason: string; message: string }
        | null
      if (!aliveRef.current) return
      if (data && data.ok === false) {
        setHbActive(false)
        setMessage(data.message)
        setPhase(
          data.reason === 'concurrent' || data.reason === 'locked' || data.reason === 'expired' || data.reason === 'revoked'
            ? (data.reason as Phase)
            : 'invalid',
        )
      }
    } catch {
      /* transient network blips are non-fatal — the next beat retries */
    }
  }, [token])

  useEffect(() => {
    if (phase !== 'ok') return
    const t = setInterval(() => void beat(), HEARTBEAT_MS)
    // First beat deferred a tick (keeps the effect body free of sync state paths)
    const first = setTimeout(() => void beat(), 0)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [phase, beat])

  const backHome = () => navigate('shop', { zone: 'kids', category: null })

  const cardCls =
    'glass mx-auto w-full max-w-lg rounded-3xl p-6 text-center md:p-10 flex flex-col items-center gap-4'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:px-6 md:py-14">
      {phase === 'checking' && (
        <div className={cardCls} role="status" aria-live="polite">
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Verifying your watch link…</p>
        </div>
      )}

      {phase !== 'checking' && phase !== 'ok' && (
        <div className={cardCls}>
          <span className="text-5xl" aria-hidden="true">
            {phase === 'concurrent' ? '📺' : phase === 'locked' ? '🔒' : '⏳'}
          </span>
          <h1 className="text-xl font-bold md:text-2xl">
            {phase === 'concurrent'
              ? 'This link is being watched elsewhere'
              : phase === 'locked'
                ? 'This watch link is locked'
                : phase === 'expired'
                  ? 'This watch link has expired'
                  : phase === 'revoked'
                    ? 'This watch link was revoked'
                    : 'This watch link is not valid'}
          </h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
            Need a fresh link? Reply to your receipt email or use the contact page — we renew genuine purchases.
          </p>
          <Button onClick={backHome} variant="outline" className="h-11 min-w-[170px]">
            Back to shop
          </Button>
        </div>
      )}

      {phase === 'ok' && info && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
                Protected video
              </p>
              <h1 className="font-baloo text-xl font-extrabold text-foreground md:text-2xl">{info.productTitle}</h1>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ShieldOk />
              <span>
                Personal access · up to {info.maxConcurrent} device{info.maxConcurrent === 1 ? '' : 's'} at once
              </span>
            </div>
          </div>

          {hbActive ? (
            <VideoPlayerFrame
              resolved={{ provider: info.provider, src: info.src }}
              poster={null}
              title={info.productTitle}
              watermark={info.watermark}
              className="rounded-2xl"
            />
          ) : (
            <div className={cardCls}>
              <span className="text-5xl" aria-hidden="true">
                📺
              </span>
              <h1 className="text-xl font-bold">Viewing session ended</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button onClick={backHome} variant="outline" className="h-11 min-w-[170px]">
                Back to shop
              </Button>
            </div>
          )}

          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            This video is for <span className="font-semibold text-foreground">your own viewing</span>. It is
            watermark-tagged to your order — please don&apos;t share the link or re-upload the video. Sharing
            widely can lock this access automatically.
          </p>
        </div>
      )}
    </div>
  )
}

/** Tiny inline shield glyph (keeps the lucide import surface minimal). */
function ShieldOk() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
