'use client'

// ═══════════════════════════════════════════════════════════
// T-V Feature B — click-to-play video frame (product pages).
//
// • NOTHING loads until the visitor presses Play: the poster
//   (first product image) sits under a real <button>, so YouTube
//   / video files are fetched only on demand (privacy + speed,
//   especially on Kids pages).
// • Sources arrive from the SERVER (/api/video/preview) — the
//   raw admin link never reaches the client bundle.
// • YouTube embeds use youtube-nocookie.com with fs=0 — the
//   site ships ITS OWN fullscreen button (browser Fullscreen
//   API; iOS falls back to a CSS overlay that traps scroll and
//   closes on Esc / Close).
// • ImageKit / direct .mp4-.webm files: <video> with
//   controlsList="nodownload", disallowFullscreen via our own
//   control, context-menu blocked.
// • Responsive 16:9 (aspect-video) — no layout jump.
// • Optional moving watermark (Feature C) rendered ABOVE the
//   player area but never covering YouTube's own controls/brand.
// • Reduced-motion friendly: no animations, pure state swap.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { Expand, Loader2, Minimize2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { imgFallbackToHq } from '@/lib/video-thumb'

export interface VideoPlayerFrameProps {
  /** Product slug — used to fetch the safe play URL on demand (storefront). */
  slug?: string
  /** ALREADY-RESOLVED server source (protected watch page) — skips the
   *  public preview endpoint entirely. Never pass a raw admin link. */
  resolved?: { provider: 'youtube' | 'imagekit' | 'file'; src: string } | null
  /** Poster image (first product image) shown before Play. */
  poster?: string | null
  /** Accessible title (product name). */
  title: string
  /** Feature C — moving watermark text rendered over the video area. */
  watermark?: string | null
  className?: string
}

interface ResolveResponse {
  provider: 'youtube' | 'imagekit' | 'file'
  src: string
}

/** iOS Safari cannot use the Fullscreen API on arbitrary elements → CSS overlay. */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Watermark dwell positions — percentages inside the SAFE zone (above
 *  YouTube's bottom control bar and below the top title, brief §C: never
 *  cover YouTube's controls, title or branding). */
const WATERMARK_SPOTS = [
  { top: '18%', left: '8%' },
  { top: '18%', left: '58%' },
  { top: '52%', left: '12%' },
  { top: '52%', left: '60%' },
  { top: '32%', left: '34%' },
] as const

export default function VideoPlayerFrame({ slug, resolved, poster, title, watermark, className }: VideoPlayerFrameProps) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [src, setSrc] = useState<string | null>(resolved?.src ?? null)
  const [provider, setProvider] = useState<'youtube' | 'imagekit' | 'file' | null>(resolved?.provider ?? null)
  const [error, setError] = useState<string | null>(null)
  const [fsActive, setFsActive] = useState(false)
  const [fsFallback, setFsFallback] = useState(false)
  const [spot, setSpot] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  // ── Play → fetch the safe source from the server (never bundled) ──
  const handlePlay = useCallback(async () => {
    if (playing || loading) return
    // Pre-resolved source (protected watch page): no fetch at all.
    if (resolved?.src) {
      setProvider(resolved.provider)
      setSrc(resolved.src)
      setPlaying(true)
      return
    }
    if (!slug) {
      setError('Video is not available right now — please try again later.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/video/preview?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as ResolveResponse | { error?: string } | null
      if (!res.ok || !data || !('src' in data) || !data.src) {
        setError('Video is not available right now — please try again later.')
        return
      }
      setProvider(data.provider)
      setSrc(data.src)
      setPlaying(true)
    } catch {
      setError('Video is not available right now — please try again later.')
    } finally {
      setLoading(false)
    }
  }, [slug, resolved, playing, loading])

  // ── Watermark mover (Feature C: new place every ~10s) ──
  useEffect(() => {
    if (!watermark || !playing) return
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return // respect reduced motion — keep the first spot
    const t = setInterval(() => setSpot((s) => (s + 1) % WATERMARK_SPOTS.length), 10_000)
    return () => clearInterval(t)
  }, [watermark, playing])

  // ── Fullscreen: native API where available, CSS overlay on iOS ──
  const syncFsState = useCallback(() => {
    setFsActive(Boolean(document.fullscreenElement) && document.fullscreenElement === wrapRef.current)
  }, [])

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncFsState)
    return () => document.removeEventListener('fullscreenchange', syncFsState)
  }, [syncFsState])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => setFsFallback(false))
      setFsFallback(false)
      return
    }
    if (isIos() || !el.requestFullscreen) {
      setFsFallback(true) // iOS: CSS overlay fallback
      return
    }
    el.requestFullscreen().catch(() => setFsFallback(true))
  }, [])

  // Esc closes the CSS overlay; body scroll locked while it is open.
  useEffect(() => {
    if (!fsFallback) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFsFallback(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [fsFallback])

  const showWatermark = Boolean(watermark) && playing

  return (
    <>
      <div
        ref={wrapRef}
        className={cn(
          'group relative aspect-video w-full overflow-hidden bg-black',
          fsActive && 'h-screen w-auto max-w-full self-center',
          className,
        )}
      >
        {!playing ? (
          <>
            {poster ? (
              <img
                src={poster}
                alt=""
                aria-hidden="true"
                onError={imgFallbackToHq}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(229,184,66,0.25),rgba(0,0,0,0.9))]" aria-hidden="true" />
            )}
            {/* The play affordance is a real button — keyboard operable, 44px+ */}
            <button
              type="button"
              onClick={() => void handlePlay()}
              aria-label={`Play video: ${title}`}
              className="absolute inset-0 z-10 grid min-h-[44px] place-items-center focus-visible:outline-none"
            >
              <span className="grid size-16 place-items-center rounded-full bg-[#e5b842] text-black shadow-[0_10px_36px_rgba(229,184,66,0.55)] transition-transform duration-200 group-hover:scale-105 group-focus-visible:scale-105 md:size-20">
                {loading ? (
                  <Loader2 className="size-7 animate-spin md:size-9" aria-hidden="true" />
                ) : (
                  <Play className="ml-1 size-7 md:size-9" aria-hidden="true" fill="currentColor" />
                )}
              </span>
            </button>
            {error && (
              <p role="alert" className="absolute inset-x-3 bottom-3 z-20 rounded-lg bg-red-950/90 px-3 py-2 text-center text-xs font-semibold text-red-100">
                {error}
              </p>
            )}
          </>
        ) : provider === 'youtube' && src ? (
          <iframe
            src={`${src}&autoplay=1`}
            title={`${title} — video`}
            // No allowFullScreen: YouTube's own fullscreen button is OFF (fs=0);
            // our accessible fullscreen control owns that job.
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            aria-label={`${title} — video player`}
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (provider === 'imagekit' || provider === 'file') && src ? (
          <video
            src={src}
            controls
            playsInline
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`${title} — video player`}
            className="absolute inset-0 h-full w-full"
          />
        ) : null}

        {/* T-V Feature C — moving buyer watermark. Pointer-events-none so it
            never blocks YouTube's own UI; positioned above the control bar. */}
        {showWatermark && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5]">
            <span
              className="absolute whitespace-nowrap rounded bg-black/35 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-white/70 backdrop-blur-[1px] transition-all duration-700 md:text-[11px]"
              style={{ top: WATERMARK_SPOTS[spot].top, left: WATERMARK_SPOTS[spot].left }}
            >
              {watermark}
            </span>
          </div>
        )}

        {/* Our own fullscreen button (independent of the provider). */}
        {playing && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fsActive || fsFallback ? 'Exit full screen' : 'Enter full screen'}
            className="absolute right-3 top-3 z-20 grid size-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5b842]"
          >
            {fsActive || fsFallback ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Expand className="size-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* ── iOS fullscreen fallback: CSS overlay over the whole screen ── */}
      {fsFallback && playing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — full screen video`}
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black"
        >
          <div className="relative aspect-video max-h-full w-full max-w-full">
            {provider === 'youtube' && src ? (
              <iframe
                src={`${src}&autoplay=1`}
                title={`${title} — video`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                aria-label={`${title} — video player`}
                className="absolute inset-0 h-full w-full border-0"
              />
            ) : (provider === 'imagekit' || provider === 'file') && src ? (
              <video
                src={src}
                controls
                autoPlay
                playsInline
                controlsList="nodownload noplaybackrate"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
                aria-label={`${title} — video player`}
                className="absolute inset-0 h-full w-full"
              />
            ) : null}
            {showWatermark && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5]">
                <span
                  className="absolute whitespace-nowrap rounded bg-black/35 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-white/70"
                  style={{ top: WATERMARK_SPOTS[spot].top, left: WATERMARK_SPOTS[spot].left }}
                >
                  {watermark}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setFsFallback(false)}
              aria-label="Close full screen"
              className="absolute right-3 top-3 z-20 grid h-11 min-w-[44px] place-items-center rounded-full bg-white/15 px-4 text-sm font-semibold text-white backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5b842]"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
