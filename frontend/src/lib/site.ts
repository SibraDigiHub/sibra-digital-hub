// ─────────────────────────────────────────────────────────────
// Site identity + canonical URL — single source of truth for the
// OG/Twitter metadata (layout.tsx) and the
// /llms.txt route. The production origin comes from the
// NEXT_PUBLIC_SITE_URL env var (see .env.example); local dev
// falls back to the dev server origin.
// ─────────────────────────────────────────────────────────────

export const SITE_NAME = 'Sibra Digital Hub'
export const SITE_TAGLINE = 'Digital Kidosphere & Creator Hub'

export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim()
  if (raw === '') return 'http://localhost:3000'
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}
