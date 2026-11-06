// ═══════════════════════════════════════════════════════════
// Route-level error boundary (App Router). Only renders when a
// real-route render/hydration throws — normal navigation and the
// hash SPA are unaffected. Same visual family as the 404 page.
// Must be a client component; `reset()` retries the render.
// ═══════════════════════════════════════════════════════════

'use client'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-7xl" aria-hidden="true">
        🧩
      </span>
      <h1 className="text-2xl font-bold md:text-3xl">Oops! Something slipped.</h1>
      <p className="text-muted-foreground">
        This shelf wobbled for a moment. Give it another try — it usually fixes itself.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="flex h-11 min-w-[180px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        <a
          href="/"
          className="flex h-11 min-w-[140px] items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          ← Back home
        </a>
      </div>
      {error.digest ? (
        <p className="text-xs text-muted-foreground/70">Ref: {error.digest}</p>
      ) : null}
    </div>
  )
}
