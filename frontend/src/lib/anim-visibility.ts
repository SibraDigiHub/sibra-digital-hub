'use client'

// ═══════════════════════════════════════════════════════════
// Animation-visibility guard (T4.3) — infinite CSS animations
// only run while their element is actually on screen (plus a
// small margin). Off-screen headings/marquees/blobs are paused
// via `animation-play-state`, which changes NO visual property
// — when an element scrolls back in, the animation resumes from
// the paused frame, so the look and speed are unchanged.
// The gateway letter-wave and blob animations are also paused
// while the zone animation owns the screen (setSuppressed).
// ═══════════════════════════════════════════════════════════

const SELECTOR = [
  '.blob',
  '.holo-text',
  '.kid-float',
  '.chameleon-sweep',
  '.chameleon-letter',
  '.ticker-track',
  '.journey-track',
  '.legal-hero-glow',
].join(', ')

const MARGIN = '140px'

export interface AnimVisibilityGuard {
  /** Pause every guarded animation (zone animation running). */
  setSuppressed: (paused: boolean) => void
  dispose: () => void
}

export function installAnimVisibilityGuard(): AnimVisibilityGuard {
  if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') {
    return { setSuppressed: () => undefined, dispose: () => undefined }
  }

  const observed = new WeakSet<Element>()
  let suppressed = false

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement
        if (e.isIntersecting) {
          // Visible (or nearly): the stylesheet decides — unless the
          // whole page is suppressed by the transition.
          el.style.animationPlayState = suppressed ? 'paused' : ''
        } else {
          el.style.animationPlayState = 'paused'
        }
      }
    },
    { rootMargin: `${MARGIN} 0px ${MARGIN} 0px` },
  )

  const observeAll = () => {
    for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      if (observed.has(el)) continue
      observed.add(el)
      io.observe(el)
    }
  }

  // New elements appear as views mount — re-scan, throttled to one
  // scan per idle window (a MutationObserver on a SPA fires often).
  let scanTimer = 0
  const mo = new MutationObserver(() => {
    if (scanTimer) return
    scanTimer = window.setTimeout(() => {
      scanTimer = 0
      observeAll()
    }, 400)
  })

  observeAll()
  mo.observe(document.body, { childList: true, subtree: true })

  return {
    setSuppressed: (paused) => {
      suppressed = paused
      for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        el.style.animationPlayState = paused ? 'paused' : ''
      }
    },
    dispose: () => {
      if (scanTimer) window.clearTimeout(scanTimer)
      mo.disconnect()
      io.disconnect()
    },
  }
}
