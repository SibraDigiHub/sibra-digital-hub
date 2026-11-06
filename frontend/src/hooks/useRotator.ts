'use client'

// ═══════════════════════════════════════════════════════════
// useRotator — auto-advancing image rotator for product cards
// (PRD §8.1 / §11.1). 2500ms default cadence, pauses when the
// tab is hidden, the element scrolls off-screen, the caller
// pauses it (hover/stay) or disables it. A one-time random
// 0–800ms start offset keeps a grid of cards from flipping in
// sync. Manual advance (arrows/swipe/dots) reschedules the
// timer from "now".
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'

export interface RotatorOptions {
  /** ms between automatic advances (default 2500) */
  interval?: number
  /** master switch — false stops the auto timer entirely */
  enabled?: boolean
}

export function useRotator(images: string[], opts?: RotatorOptions) {
  const intervalMs = opts?.interval ?? 2500
  const enabled = opts?.enabled ?? true
  const total = images.length

  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(true)
  const [docHidden, setDocHidden] = useState(false)

  /** Attach to the rotator's container so visibility can be tracked */
  const ref = useRef<HTMLDivElement | null>(null)

  // One-time random start offset (0–800ms) so a grid of cards never
  // flips in sync. false = not yet consumed; once consumed every later
  // tick (auto or manual) uses the full intervalMs.
  const desynced = useRef(false)

  // Core auto-advance timer. `index` is a dependency on purpose:
  // every advance (auto or manual) re-runs the effect, which clears
  // the pending timeout and schedules a fresh one = "reset the timer".
  const active = enabled && !paused && !docHidden && inView && total > 1
  useEffect(() => {
    if (!active) return
    const delay = desynced.current ? intervalMs : Math.random() * 800
    desynced.current = true
    const t = setTimeout(() => {
      setIndex((i) => (total > 0 ? (i + 1) % total : 0))
    }, delay)
    return () => clearTimeout(t)
  }, [active, index, intervalMs, total])

  // Pause while the browser tab itself is hidden
  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    onVis()
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Pause while the attached element is scrolled out of view
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Index stays valid even if the image list shrinks: wrap at the boundary.
  const safeIndex = total > 0 ? ((index % total) + total) % total : 0

  const goTo = useCallback(
    (i: number) => {
      if (total <= 0) return
      setIndex(((i % total) + total) % total)
    },
    [total],
  )

  const next = useCallback(() => {
    setIndex((i) => (total > 0 ? (i + 1) % total : 0))
  }, [total])

  const prev = useCallback(() => {
    setIndex((i) => (total > 0 ? (i - 1 + total) % total : 0))
  }, [total])

  /** Manual advance (hover / tap) — moves next AND resets the timer */
  const advanceManual = useCallback(() => {
    setIndex((i) => (total > 0 ? (i + 1) % total : 0))
  }, [total])

  return { index: safeIndex, goTo, next, prev, advanceManual, paused, setPaused, inView, ref }
}
