// ═══════════════════════════════════════════════════════════
// Quality tiers (B6) — T2 = desktop / good phones, T1 = weak
// phones, T0 = no compositing/GPU or a thrown probe (CSS-only
// ReducedCpuStage, same storyline + duration). Counts feed the
// choreographies and the Particles2D layer.
// ═══════════════════════════════════════════════════════════

import { TIER_BUDGETS } from './constants'

export type Tier = 'T0' | 'T1' | 'T2'

export interface TierBudget {
  /** 3D DOM items on stage at once. */
  domItems: number
  /** Canvas-2D particles (pooled — the layer's hard cap). */
  particles: number
  /** Creator code-rain columns. */
  codeRainColumns: number
}

export function budgetFor(tier: Tier): TierBudget {
  return TIER_BUDGETS[tier]
}

/**
 * Silent adaptive downgrade (B6): halves the counts but never below the
 * T1 floor, so a T1/T2 run degrades gracefully instead of collapsing to 0.
 */
export function downgraded(b: TierBudget): TierBudget {
  const floor = TIER_BUDGETS.T1
  return {
    domItems: Math.max(floor.domItems, Math.round(b.domItems / 2)),
    particles: Math.max(floor.particles, Math.round(b.particles / 2)),
    codeRainColumns: Math.max(floor.codeRainColumns, Math.round(b.codeRainColumns / 2)),
  }
}
