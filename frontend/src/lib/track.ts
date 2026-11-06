'use client'

// ═══════════════════════════════════════════════════════════
// Client-side analytics beacon (PRD v6.1 §11 funnel input).
// Fire-and-forget: analytics can never break the UI.
// ═══════════════════════════════════════════════════════════

export function track(type: string, payload: Record<string, unknown> = {}): void {
  try {
    if (typeof window === 'undefined') return
    const body = JSON.stringify({ type, ...payload })
    const nav = navigator as Navigator & { sendBeacon?: (url: string, data: BodyInit) => boolean }
    if (typeof nav.sendBeacon === 'function') {
      nav.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never break the UI
  }
}
