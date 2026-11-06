'use client'

// ═══════════════════════════════════════════════════════════
// Reveal-on-scroll that survives late-mounted children (e.g.
// async-loaded FAQ items). Re-scans the subtree with a
// MutationObserver so nothing stays invisible forever.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import type { DependencyList } from 'react'

export function useStaggerReveal<T extends HTMLElement>(opts?: {
  step?: number
  maxDelay?: number
  threshold?: number
  deps?: DependencyList
}) {
  const ref = useRef<T | null>(null)
  const { step = 90, maxDelay = 400, threshold = 0.12, deps = [] } = opts ?? {}

  useEffect(() => {
    const root = ref.current
    if (!root) return

    if (typeof IntersectionObserver === 'undefined') {
      root.querySelectorAll<HTMLElement>('.reveal').forEach((el) => el.classList.add('revealed'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          el.classList.add('revealed')
          io.unobserve(el)
        }
      },
      { threshold, rootMargin: '0px 0px -32px 0px' },
    )

    const seen = new WeakSet<HTMLElement>()
    let order = 0
    const scan = () => {
      root.querySelectorAll<HTMLElement>('.reveal:not(.revealed)').forEach((el) => {
        if (seen.has(el)) return
        seen.add(el)
        if (!el.style.transitionDelay) {
          el.style.transitionDelay = `${Math.min(order * step, maxDelay)}ms`
        }
        order += 1
        io.observe(el)
      })
    }
    scan()

    const mo = new MutationObserver(() => scan())
    mo.observe(root, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, deps)

  return ref
}
