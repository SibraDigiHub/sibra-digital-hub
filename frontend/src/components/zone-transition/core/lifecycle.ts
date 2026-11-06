// ═══════════════════════════════════════════════════════════
// lifecycle (B6 "zero leftovers") — ONE cleanup registry for a
// run: every resource (timelines, rAF, listeners, timers,
// audio, scroll guard) is added as a disposer and disposeAll()
// runs on EVERY exit path (done, Skip, Back, watchdog, error,
// unmount). Disposers never throw the cleanup away: each error
// is collected, the rest still dispose, and everything is
// logged exactly once. guard() wraps event callbacks so a
// throwing handler can never kill the run.
// ═══════════════════════════════════════════════════════════

export type Disposer = () => void

export interface Lifecycle {
  /** Register a disposer. Registering after disposeAll runs it immediately (no leaks). */
  add(dispose: Disposer): void
  /** Idempotent: collects errors, disposes the rest, logs once. */
  disposeAll(): void
  /** Wrap a callback so it never throws. */
  guard<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void
}

export function createLifecycle(): Lifecycle {
  const disposers: Disposer[] = []
  let disposed = false
  return {
    add(dispose) {
      if (disposed) {
        dispose()
        return
      }
      disposers.push(dispose)
    },
    disposeAll() {
      if (disposed) return
      disposed = true
      const failures: unknown[] = []
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          failures.push(error)
        }
      }
      disposers.length = 0
      if (failures.length > 0) {
        console.warn(`zone-transition: ${failures.length} disposer(s) failed during cleanup (rest disposed)`, failures)
      }
    },
    guard(fn) {
      return (...args) => {
        try {
          fn(...args)
        } catch (error) {
          console.warn('zone-transition: guarded call failed', error)
        }
      }
    },
  }
}
