'use client'

// ═══════════════════════════════════════════════════════════
// Dopamine cursor trails (PRD §12) — desktop pointer only.
// Kids: amber/rose sparkle stars · Creator: cyan glow dots ·
// Gateway: gold sparkles. Capped at 20 live particles.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '@/store/app-store'

interface Particle {
  id: number
  x: number
  y: number
  size: number
  rot: number
  color: string
  kind: 'star' | 'dot'
}

export default function CursorFX() {
  const view = useAppStore((s) => s.view)
  const [particles, setParticles] = useState<Particle[]>([])
  const [enabled, setEnabled] = useState(false)
  const idRef = useRef(0)
  const lastRef = useRef(0)

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    const enableId = window.setTimeout(() => setEnabled(true), 0)

    const onMove = (e: MouseEvent) => {
      const now = performance.now()
      if (now - lastRef.current < 40) return
      lastRef.current = now

      const z = document.documentElement.dataset.zone
      const kind: Particle['kind'] = z === 'creator' ? 'dot' : 'star'
      const color =
        view === 'gateway'
          ? '#E5B842'
          : z === 'kids'
            ? Math.random() > 0.5
              ? '#FFB347'
              : '#FCE5CD'
            : '#00F0FF'

      const p: Particle = {
        id: ++idRef.current,
        x: e.clientX,
        y: e.clientY,
        size: 9 + Math.random() * 10,
        rot: Math.random() * 120 - 60,
        color,
        kind,
      }
      setParticles((prev) => [...prev.slice(-19), p])
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.clearTimeout(enableId)
      window.removeEventListener('mousemove', onMove)
    }
  }, [view])

  if (!enabled) return null

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]">
      <AnimatePresence>
        {particles.map((p) => (
          <motion.span
            key={p.id}
            className="absolute left-0 top-0 block"
            initial={{ x: p.x - p.size / 2, y: p.y - p.size / 2, opacity: 0.9, scale: 0.5, rotate: p.rot }}
            animate={{ y: p.y - p.size / 2 - 16, opacity: 0, scale: 1.35 }}
            exit={{ opacity: 0, scale: 0.3 }}
            transition={{ duration: p.kind === 'dot' ? 0.5 : 0.6, ease: 'easeOut' }}
            onAnimationComplete={() => setParticles((prev) => prev.filter((q) => q.id !== p.id))}
            style={
              p.kind === 'dot'
                ? {
                    width: p.size * 0.45,
                    height: p.size * 0.45,
                    borderRadius: '9999px',
                    background: '#00F0FF',
                    boxShadow: '0 0 12px 4px rgba(0,240,255,0.55)',
                  }
                : undefined
            }
          >
            {p.kind === 'star' && (
              <svg width={p.size} height={p.size} viewBox="0 0 24 24" fill={p.color} style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.35))' }}>
                <path d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z" />
              </svg>
            )}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )
}
