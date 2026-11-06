'use client'

// ═══════════════════════════════════════════════════════════
// useMarqueeFallback — keeps the RTL marquees gliding on EVERY
// device. The CSS keyframe animation (ticker-rtl) stays the
// primary driver, exactly as before. This hook only spins up a
// requestAnimationFrame fallback when it detects that the CSS
// animation is actually suppressed on the current device — e.g.
// `prefers-reduced-motion: reduce` (Android "Remove animations"
// and many in-app browsers force it) or a webview that drops
// CSS animations entirely. When the CSS animation is present
// this hook is a complete no-op, so the existing smooth
// behaviour is untouched.
// ═══════════════════════════════════════════════════════════

import { useEffect, type DependencyList, type RefObject } from 'react'

export function useMarqueeFallback(
  ref: RefObject<HTMLElement | null>,
  durationSec = 45,
  /** Re-run when the track mounts late (async content, view swaps). */
  deps: DependencyList = [],
) {
  useEffect(() => {
    const track = ref.current
    if (!track) return

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')

    let raf = 0
    let last = 0
    let offset = 0
    let half = 0 // width of one content set (track is rendered twice)
    let pointerPaused = false

    const measure = () => {
      const first = track.firstElementChild as HTMLElement | null
      half = first ? first.getBoundingClientRect().width : 0
      if (!half) half = track.scrollWidth / 2
    }

    const tick = (now: number) => {
      if (last === 0) last = now
      const dt = Math.min(now - last, 64) // clamp tab-switch jumps
      last = now
      if (!document.hidden && !pointerPaused && half > 0) {
        offset += (dt / (durationSec * 1000)) * half
        if (offset >= half) {
          offset -= half
          measure() // re-measure on wrap (fonts/images may have settled)
        }
        track.style.transform = `translate3d(${-offset.toFixed(2)}px, 0, 0)`
      }
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      if (raf) return
      measure()
      last = 0
      raf = requestAnimationFrame(tick)
    }

    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      last = 0
      offset = 0
      track.style.transform = ''
    }

    /** True while the CSS keyframe animation is actually applied. */
    const isCssDriving = () => {
      const name = window.getComputedStyle(track).animationName
      return name !== 'none' && name !== ''
    }

    const sync = () => {
      if (isCssDriving()) stop()
      else if (!pointerPaused) start()
    }

    const onPointerEnter = () => {
      pointerPaused = true
    }
    const onPointerLeave = () => {
      pointerPaused = false
      if (!isCssDriving()) start()
    }

    const onResize = () => {
      if (raf) measure()
    }

    // Re-check twice: immediately (post-paint) and once after
    // late stylesheets/font loading have settled — plus a light
    // periodic re-sync so late suppression (webviews, HMR,
    // dynamic stylesheets) still hands control to the fallback.
    const t1 = window.setTimeout(sync, 80)
    const t2 = window.setTimeout(sync, 1200)
    const t3 = window.setInterval(sync, 2500)
    mq.addEventListener('change', sync)
    window.addEventListener('resize', onResize)
    track.addEventListener('pointerenter', onPointerEnter)
    track.addEventListener('pointerleave', onPointerLeave)
    sync()

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearInterval(t3)
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', onResize)
      track.removeEventListener('pointerenter', onPointerEnter)
      track.removeEventListener('pointerleave', onPointerLeave)
      stop()
    }
  }, [ref, durationSec, ...deps])
}
