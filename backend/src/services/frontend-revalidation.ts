// Shared backend-to-frontend cache invalidation for public content mutations.
// This is intentionally separate from storage cleanup so catalog/category
// routes do not import the storage provider and cleanup orchestration graph.

/**
 * Revalidate the frontend's tagged SEO/catalog cache after a public content
 * mutation. Best-effort: the database write has already committed, and the
 * frontend's short ISR window remains the fallback if this request fails.
 */
export async function notifyFrontendRevalidate(): Promise<boolean> {
  const base = process.env.PUBLIC_WEB_URL
  const key = process.env.INTERNAL_API_KEY
  if (!base || !key) return false

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/revalidate`, {
      method: 'POST',
      // The frontend proxy re-stamps x-internal-key; x-revalidate-key is
      // preserved for the frontend-local route's timing-safe authentication.
      headers: { 'x-internal-key': key, 'x-revalidate-key': key },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
