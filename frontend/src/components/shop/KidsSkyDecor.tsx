'use client'

// ═══════════════════════════════════════════════════════════
// KidsSkyDecor — ambient 3D "sky" for the Kids Zone. Floating
// clouds, balloons, stars, rockets and building blocks drift
// behind the catalog on pure CSS keyframes (GPU-cheap, no JS
// loop). Rendered only while the Kids Zone shop/product is
// active; hidden from assistive tech; honours reduced-motion
// (display:none via globals.css).
// ═══════════════════════════════════════════════════════════

interface Floater {
  emoji: string
  top: string
  left: string
  size: string
  anim: 'kid-float-a' | 'kid-float-b' | 'kid-float-c'
  delay: string
  opacity: number
  blur?: boolean
}

const FLOATERS: Floater[] = [
  { emoji: '☁️', top: '6%', left: '4%', size: 'clamp(40px, 6vw, 84px)', anim: 'kid-float-a', delay: '0s', opacity: 0.5, blur: true },
  { emoji: '☁️', top: '16%', left: '78%', size: 'clamp(36px, 5vw, 72px)', anim: 'kid-float-b', delay: '-2.5s', opacity: 0.45, blur: true },
  { emoji: '🎈', top: '38%', left: '2%', size: 'clamp(30px, 4vw, 58px)', anim: 'kid-float-b', delay: '-1s', opacity: 0.55 },
  { emoji: '🎈', top: '58%', left: '92%', size: 'clamp(26px, 3.4vw, 50px)', anim: 'kid-float-a', delay: '-4s', opacity: 0.5 },
  { emoji: '⭐', top: '26%', left: '88%', size: 'clamp(20px, 2.6vw, 40px)', anim: 'kid-float-a', delay: '-3s', opacity: 0.55 },
  { emoji: '🌟', top: '8%', left: '38%', size: 'clamp(18px, 2.2vw, 34px)', anim: 'kid-float-b', delay: '-5.5s', opacity: 0.5 },
  { emoji: '🚀', top: '72%', left: '6%', size: 'clamp(24px, 3vw, 46px)', anim: 'kid-float-c', delay: '-2s', opacity: 0.5 },
  { emoji: '🧸', top: '84%', left: '86%', size: 'clamp(24px, 3vw, 46px)', anim: 'kid-float-b', delay: '-6s', opacity: 0.42 },
  { emoji: '🧩', top: '52%', left: '12%', size: 'clamp(20px, 2.6vw, 40px)', anim: 'kid-float-a', delay: '-1.8s', opacity: 0.4 },
  { emoji: '🎨', top: '34%', left: '68%', size: 'clamp(20px, 2.6vw, 38px)', anim: 'kid-float-c', delay: '-7s', opacity: 0.4 },
  { emoji: '🌈', top: '90%', left: '30%', size: 'clamp(28px, 3.6vw, 56px)', anim: 'kid-float-a', delay: '-3.4s', opacity: 0.35, blur: true },
  { emoji: '✏️', top: '66%', left: '55%', size: 'clamp(18px, 2.2vw, 34px)', anim: 'kid-float-b', delay: '-8s', opacity: 0.38 },
]

export default function KidsSkyDecor() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      data-testid="kids-sky-decor"
    >
      {/* soft warm glows anchoring the sky — kept gentle so the
          page stays light and easy on the eyes */}
      <div
        className="absolute -top-24 left-1/2 h-[42vw] w-[42vw] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(255,214,140,0.34), transparent 65%)' }}
      />
      <div
        className="absolute bottom-[-12%] right-[-8%] h-[36vw] w-[36vw] rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(255,179,199,0.26), transparent 62%)' }}
      />
      {FLOATERS.map((f, i) => (
        <span
          key={i}
          className={`kid-float ${f.anim}`}
          style={{
            top: f.top,
            left: f.left,
            fontSize: f.size,
            opacity: f.opacity,
            animationDelay: f.delay,
            filter: f.blur
              ? 'blur(2px) drop-shadow(0 10px 14px rgba(255,136,0,0.14))'
              : undefined,
          }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  )
}
