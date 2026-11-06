'use client'

import type { JSX } from 'react'

// ProgressRing — the compile/deploy meter (B5): SVG ring whose
// dashoffset + the counting number are driven by the master
// timeline via direct DOM writes (NO React state per frame);
// segmented bar ticks are flipped with tl.set at build time;
// the ✓ pops at 100 % via [data-c-check].

import { CREATOR_COLORS } from '../../config/constants'

const R = 54
const CIRC = Math.round(2 * Math.PI * R * 100) / 100

export default function ProgressRing({ segments }: { segments: number }): JSX.Element {
  return (
    <div
      data-c-ringwrap
      aria-hidden="true"
      className="absolute"
      style={{
        left: '50%',
        top: '45%',
        width: '34vmin',
        height: '34vmin',
        marginLeft: '-17vmin',
        marginTop: '-17vmin',
        opacity: 0,
        willChange: 'transform, opacity',
      }}
    >
      <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%' }}>
        <circle cx="60" cy="60" r={R} fill="rgba(5,7,6,0.82)" stroke="#12201B" strokeWidth="7" />
        <circle
          data-c-arc
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={CREATOR_COLORS.cyan}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <span
        data-c-num
        className="absolute inset-0 grid place-items-center font-mono"
        style={{ color: '#EAF7F2', fontSize: '5.2vmin', fontWeight: 700, textShadow: `0 0 14px ${CREATOR_COLORS.cyan}66` }}
      />
      <span
        data-c-check
        className="absolute grid place-items-center"
        style={{
          left: '70%',
          top: '12%',
          width: '8vmin',
          height: '8vmin',
          borderRadius: '50%',
          background: CREATOR_COLORS.green,
          color: '#04110B',
          fontSize: '4.4vmin',
          fontWeight: 800,
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      >
        ✓
      </span>
      <div className="absolute flex" style={{ left: '6%', right: '6%', bottom: '-5vmin', gap: '0.8vmin' }}>
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} data-c-seg={i} className="flex-1" style={{ height: '1.2vmin', borderRadius: 999, background: CREATOR_COLORS.green, opacity: 0.22, willChange: 'opacity' }} />
        ))}
      </div>
    </div>
  )
}
