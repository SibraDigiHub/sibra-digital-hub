// ═══════════════════════════════════════════════════════════
// Skip registry — module-level handle so the stage's Skip
// button, Esc/Enter/Space and the browser Back button can
// fast-forward the running sequence no matter which component
// is mounted. The stage registers the live skip; the no-op
// default keeps every caller safe when nothing runs.
// ═══════════════════════════════════════════════════════════

export const NOOP_ZONE_SKIP = () => undefined

export const zoneSkipRef: { current: () => void } = {
  current: NOOP_ZONE_SKIP,
}

export function hasZoneSkipHandler(): boolean {
  return zoneSkipRef.current !== NOOP_ZONE_SKIP
}
