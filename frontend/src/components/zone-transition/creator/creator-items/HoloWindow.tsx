'use client'

// HoloWindow — one floating holographic build window (B5): dark
// glass panel, neon frame in the variant's colour, mono title
// bar and static glyph content. The master timeline animates
// the wrapper + the [data-c-pulse] outline on each snap.

import { CREATOR_COLORS } from '../../config/constants'
import type { JSX } from 'react'

export type HoloKind = 'template' | 'prompt' | 'script' | 'uikit'

const META: Record<HoloKind, { label: string; color: string }> = {
  template: { label: 'template.ui', color: CREATOR_COLORS.violet },
  prompt: { label: 'prompt.txt', color: CREATOR_COLORS.cyan },
  script: { label: 'automation.js', color: CREATOR_COLORS.green },
  uikit: { label: 'ui-kit', color: CREATOR_COLORS.gold },
}

/** Static interior per variant — generic glyphs only (no fake copy). */
function Body({ kind }: { kind: HoloKind }): JSX.Element {
  if (kind === 'prompt') {
    return (
      <div className="font-mono" style={{ padding: '1.2vmin', fontSize: '1.7vmin', color: '#BFE9E2' }}>
        <span data-c-type />
        <span style={{ color: META.prompt.color }}>▍</span>
      </div>
    )
  }
  if (kind === 'script') {
    return (
      <div className="font-mono" style={{ padding: '1.2vmin', fontSize: '1.55vmin', lineHeight: 1.7, color: '#9FD8CC' }}>
        <div>{'const run = async () => {'}</div>
        <div>{'  await ship()'}</div>
        <div>{'}'}</div>
      </div>
    )
  }
  if (kind === 'uikit') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1vmin', padding: '1.2vmin' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ height: '3.2vmin', borderRadius: '0.6vmin', background: `${META.uikit.color}${i % 2 ? '2E' : '55'}` }} />
        ))}
      </div>
    )
  }
  return (
    <div style={{ padding: '1.2vmin', display: 'grid', gap: '0.9vmin' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: '1.4vmin', borderRadius: 999, background: `${META.template.color}${i === 0 ? '77' : '33'}`, width: i === 2 ? '62%' : '100%' }} />
      ))}
    </div>
  )
}

export default function HoloWindow({ kind }: { kind: HoloKind }): JSX.Element {
  const meta = META[kind]
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: '26vmin',
        minHeight: '14vmin',
        borderRadius: '1.2vmin',
        background: 'rgba(8,12,10,0.88)',
        border: `1px solid ${meta.color}66`,
        overflow: 'hidden',
      }}
    >
      <div className="font-mono" style={{ display: 'flex', alignItems: 'center', gap: '0.8vmin', padding: '0.9vmin 1.2vmin', borderBottom: `1px solid ${meta.color}33`, fontSize: '1.5vmin', color: meta.color }}>
        <span style={{ width: '1.1vmin', height: '1.1vmin', borderRadius: '50%', background: meta.color, opacity: 0.8 }} />
        {meta.label}
      </div>
      <Body kind={kind} />
      {/* neon outline pulse — a separate opacity-animated layer (B6) */}
      <span
        data-c-pulse
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '1.2vmin',
          border: `2px solid ${meta.color}`,
          opacity: 0,
          willChange: 'opacity',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
