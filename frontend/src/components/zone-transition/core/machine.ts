// ═══════════════════════════════════════════════════════════
// Zone phase machine (B3) — pure, no DOM: forward-only chain
// idle → arming → playing → payoff → wiping → done. Illegal
// transitions are IGNORED (double click, stale events, double
// phase reports); forceDone() from ANY state guarantees the
// visitor can never get stuck.
// ═══════════════════════════════════════════════════════════

export type ZonePhase = 'idle' | 'arming' | 'playing' | 'payoff' | 'wiping' | 'done'

const ORDER: readonly ZonePhase[] = ['idle', 'arming', 'playing', 'payoff', 'wiping', 'done']

export interface ZoneMachine {
  readonly current: ZonePhase
  /** True only for the next legal step — callers gate a second start on can('arming') from idle. */
  can(next: ZonePhase): boolean
  /** Advance forward exactly one step; anything else returns false and changes nothing. */
  go(next: ZonePhase): boolean
  /** Jump from ANY state straight to done (watchdog / error rescue). Fires once. */
  forceDone(): boolean
}

export function createZoneMachine(onChange?: (s: ZonePhase) => void): ZoneMachine {
  let state: ZonePhase = 'idle'
  const emit = () => onChange?.(state)
  const can = (next: ZonePhase) => ORDER.indexOf(next) === ORDER.indexOf(state) + 1
  return {
    get current() {
      return state
    },
    can,
    go(next) {
      if (!can(next)) return false
      state = next
      emit()
      return true
    },
    forceDone() {
      if (state === 'done') return false
      state = 'done'
      emit()
      return true
    },
  }
}
