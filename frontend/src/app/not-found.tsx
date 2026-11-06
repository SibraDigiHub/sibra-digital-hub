// ═══════════════════════════════════════════════════════════
// Global 404 — same look as the hash SPA's not-found block
// (🦖 "Roar! This page wandered off."). Rendered for unknown real
// routes (e.g. /product/unknown-slug) with a real HTTP 404 status.
// ═══════════════════════════════════════════════════════════

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-7xl" aria-hidden="true">
        🦖
      </span>
      <h1 className="text-2xl font-bold md:text-3xl">Roar! This page wandered off.</h1>
      <p className="text-muted-foreground">
        The treasure you seek isn&apos;t on this shelf — maybe it moved to another aisle.
      </p>
      <Link
        href="/shop"
        className="flex h-11 min-w-[180px] items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        ← Back to the shop
      </Link>
    </div>
  )
}
