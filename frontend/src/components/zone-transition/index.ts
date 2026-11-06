// ═══════════════════════════════════════════════════════════
// Public API of the zone-transition feature (master prompt B2)
// — the gateway and the page shell import only from here.
// ═══════════════════════════════════════════════════════════

export { useZoneTransition, useZoneTransitionHost } from './use-zone-transition'
export type { ZoneTransitionControls, ZoneTransitionRunData, Zone } from './use-zone-transition'
export { default as ZoneStage } from './stage/ZoneStage'
