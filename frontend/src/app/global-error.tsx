// ═══════════════════════════════════════════════════════════
// Global error boundary — last-resort UI when the root layout
// itself throws (render crashed before any shell could mount).
// Renders its own <html>/<body> per App Router contract.
// Normal pages never see this screen.
// ═══════════════════════════════════════════════════════════

'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 16,
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0b0b12',
          color: '#f1f1f4',
        }}
      >
        <span style={{ fontSize: 72 }} aria-hidden="true">
          🧩
        </span>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Oops! Something slipped.</h1>
        <p style={{ opacity: 0.75 }}>
          The page hit an unexpected snag. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            height: 44,
            padding: '0 24px',
            borderRadius: 6,
            border: 'none',
            background: '#f1f1f4',
            color: '#0b0b12',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        {error.digest ? (
          <p style={{ fontSize: 12, opacity: 0.5 }}>Ref: {error.digest}</p>
        ) : null}
      </body>
    </html>
  )
}
