// ═══════════════════════════════════════════════════════════
// Real-route navigation adapter.
//
// The SPA store is framework-free (no React hooks), so it cannot
// call next/navigation's router itself. The one client shell that
// hosts real routes (RealRouteShell) registers the Next router
// here on mount; store.navigate() then performs real-URL view
// changes through it (RSC navigation → correct metadata + SSR
// data for the target page).
// ═══════════════════════════════════════════════════════════

type RealNavigateFn = (path: string) => void

let navigateFn: RealNavigateFn | null = null

export function setRealNavigate(fn: RealNavigateFn): void {
  navigateFn = fn
}

export function realNavigate(path: string): void {
  if (navigateFn) {
    navigateFn(path)
    return
  }
  // Adapter not mounted (defensive — RealRouteShell always mounts one):
  // fall back to a full navigation so the link still works.
  if (typeof window !== 'undefined') window.location.assign(path)
}
