'use client'

// ═══════════════════════════════════════════════════════════
// §11.3.2 — "The 4-Step Joy of Digital Delivery"
// Bento roadmap: 4 glass tiles with LIVE animated gradient
// borders (rotating conic rim, per-step colours), breathing
// glow auras, gold outline step numbers, gradient icon discs
// with a pulsing halo, and a gold SVG path that draws itself
// with scroll progress (framer-motion pathLength).
// Copy is code-accurate to the real delivery flow: Razorpay
// secure page → seconds-fast email link → download & dive in
// → 48-hour / 5-download window (env-driven defaults).
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import { motion, useScroll } from 'framer-motion'
import { ShoppingBag, Mail, PackageOpen, Timer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStaggerReveal } from '@/hooks/useStaggerReveal'

interface Step {
  num: string
  icon: LucideIcon
  title: string
  copy: string
  chip: string
  from: string
  to: string
  glow: string
}

const STEPS: Step[] = [
  {
    num: '01',
    icon: ShoppingBag,
    title: 'Select & Pay',
    copy: 'Pick your pack and pay securely — UPI, cards and net banking via Razorpay (India); international cards (and PayPal where enabled) via Razorpay Checkout.',
    chip: 'UPI · CARDS · RAZORPAY',
    from: '#FFB347',
    to: '#FF8A3D',
    glow: 'rgba(255, 179, 71, 0.35)',
  },
  {
    num: '02',
    icon: Mail,
    title: 'Instant Email Delivery',
    copy: 'The moment your payment clears, a secure download link lands in your inbox — within seconds.',
    chip: 'EMAIL · WITHIN SECONDS',
    from: '#00F5A0',
    to: '#B8F2D0',
    glow: 'rgba(0, 245, 160, 0.30)',
  },
  {
    num: '03',
    icon: PackageOpen,
    title: 'Download & Dive In',
    copy: 'Print-ready 300 DPI sheets for the kids zone, ready-to-use packs for creators — open and start right away.',
    chip: '300 DPI · PRINT + DIGITAL',
    from: '#E5B842',
    to: '#FAE8A7',
    glow: 'rgba(229, 184, 66, 0.35)',
  },
  {
    num: '04',
    icon: Timer,
    title: 'Fresh for 48 Hours',
    copy: 'Your link stays live for 48 hours with 5 full downloads — grab it fresh, whenever you like.',
    chip: '48 HRS · 5 DOWNLOADS',
    from: '#C084FC',
    to: '#FF007F',
    glow: 'rgba(192, 132, 252, 0.30)',
  },
]

/** Decorative S-curve weaving through the 4 tiles (xl only) */
const CONNECTOR_D =
  'M 145 195 C 300 55, 430 55, 580 130 C 730 205, 870 205, 1015 75'


export default function HowItWorksBento() {
  const sectionRef = useStaggerReveal<HTMLElement>()
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.85', 'end 0.45'],
  })

  return (
    <section
      ref={sectionRef}
      aria-labelledby="how-heading"
      className="relative mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24"
    >
      {/* ── Section header ── */}
      <div className="reveal mx-auto max-w-3xl text-center">
        <p className="sec-eyebrow font-jetbrains text-xs font-semibold tracking-[0.3em] text-[#E5B842]">
          ── HOW IT WORKS ──
        </p>
        <h2
          id="how-heading"
          className="sec-heading chameleon-sweep font-playfair mt-4 text-3xl leading-tight font-semibold text-foreground md:text-5xl"
        >
          The 4-Step Joy of{' '}
          <span className="holo-text">Digital Delivery</span>
        </h2>
        <p className="shop-sub mt-4 text-sm text-muted-foreground md:text-base">
          From tap to treasure in four beats — instant email delivery, zero
          shipping, zero waiting.
        </p>
      </div>

      {/* ── Bento grid + scroll-drawn connector ── */}
      <div className="relative mt-10 md:mt-14">
        <svg
          aria-hidden="true"
          viewBox="0 0 1160 260"
          fill="none"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 hidden h-full w-full xl:block"
        >
          {/* static faint guide */}
          <path
            d={CONNECTOR_D}
            stroke="rgba(229, 184, 66, 0.14)"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* progress-drawn gold line */}
          <motion.path
            d={CONNECTOR_D}
            stroke="#E5B842"
            strokeWidth={2.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength: scrollYProgress }}
          />
        </svg>

        <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-4">
          {STEPS.map((step) => (
            <li
              key={step.num}
              className="relative"
              style={
                {
                  '--hc1': step.from,
                  '--hc2': step.to,
                  '--hc-glow': step.glow,
                } as React.CSSProperties
              }
            >
              {/* breathing colour aura behind the tile */}
              <span className="how-glow" aria-hidden="true" />
              <article className="how-card glass reveal relative z-[1] h-full overflow-hidden rounded-3xl p-6">
                {/* animated gradient rim (progressive enhancement) */}
                <span className="how-ring" aria-hidden="true" />
                <div className="flex items-start justify-between gap-4">
                  <span
                    className="font-cinzel text-5xl font-bold select-none"
                    style={{
                      WebkitTextStroke: `2px ${step.from}`,
                      color: 'transparent',
                    }}
                    aria-hidden="true"
                  >
                    {step.num}
                  </span>
                  <span
                    className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
                    style={{
                      background: `linear-gradient(135deg, ${step.from}, ${step.to})`,
                      boxShadow: `0 8px 24px ${step.glow}`,
                    }}
                    aria-hidden="true"
                  >
                    <span className="how-disc-halo" aria-hidden="true" />
                    <step.icon
                      className="h-6 w-6 text-[#050706]"
                      strokeWidth={2.2}
                    />
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-semibold text-foreground">
                  <span className="sr-only">Step {step.num}: </span>
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.copy}
                </p>
                <span
                  className="how-chip mono-tag mt-4 inline-block"
                  style={{ color: step.from, borderColor: step.glow }}
                >
                  {step.chip}
                </span>
              </article>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Payments note ── */}
      <div className="reveal mt-8 flex flex-col items-center gap-3 text-center md:mt-10">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span
            className="mono-tag"
            style={{
              color: '#FFB347',
              borderColor: 'rgba(255, 179, 71, 0.9)',
              background: 'rgba(255, 179, 71, 0.14)',
              boxShadow: '0 0 12px rgba(255, 179, 71, 0.35)',
            }}
          >
            UPI · INDIA
          </span>
          <span
            className="mono-tag"
            style={{
              color: '#00F5A0',
              borderColor: 'rgba(0, 245, 160, 0.9)',
              background: 'rgba(0, 245, 160, 0.14)',
              boxShadow: '0 0 12px rgba(0, 245, 160, 0.35)',
            }}
          >
            Razorpay · INTL
          </span>
        </div>
        <p className="shop-sub max-w-xl text-sm leading-relaxed text-muted-foreground">
          One secure checkout routed by your billing country — India: UPI,
          cards and net banking via Razorpay. Outside India? Razorpay Checkout
          where your region is enabled, otherwise the marketplace buttons on
          each product have you covered.
        </p>
      </div>
    </section>
  )
}
