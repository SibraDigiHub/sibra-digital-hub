// ═══════════════════════════════════════════════════════════
// scroll-safety (B3 — a past bug must never return): the run
// NEVER locks html/body scroll. These pure helpers snapshot the
// computed guard properties at mount so the stage can re-read
// them at cleanup and restore the snapshot if anything differs
// — a guarantee net, normally a no-op because nothing is
// touched. Pure on purpose: bun:test has no DOM.
// ═══════════════════════════════════════════════════════════

export type StyleSnapshot = Record<string, string>

/** The only properties a scroll-lock bug could ever touch. */
export const htmlBodyGuardProps = ['overflow', 'overflowX', 'overflowY', 'position', 'touchAction'] as const

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * Read the computed guard properties from `el` (wrapped so tests can pass
 * fakes and the stage can pass window.getComputedStyle(documentElement)).
 * Null-safe: a null element yields an empty snapshot.
 */
export function snapshotStyles(
  el: { getComputedStyle: () => CSSStyleDeclaration } | null,
  props: readonly string[],
): StyleSnapshot {
  if (!el) return {}
  const cs = el.getComputedStyle()
  const snap: StyleSnapshot = {}
  for (const prop of props) snap[prop] = cs.getPropertyValue(kebab(prop)).trim()
  return snap
}

/** True when any property differs between two snapshots. */
export function stylesDiffer(a: StyleSnapshot, b: StyleSnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return true
  }
  return false
}
