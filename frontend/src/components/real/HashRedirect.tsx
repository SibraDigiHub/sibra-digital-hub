'use client'

// ═══════════════════════════════════════════════════════════
// Legacy hash → real URL redirect (SEO foundation).
//
// Shared links like /#/product/<slug>, /#/shop?zone=… and the four
// real legal hashes land on "/" — this bridge redirects ONCE per
// page load to the real URL so old links keep working and crawlers
// see the canonical address. Hash views WITHOUT a real route
// (gateway, admin, thank-you, download, watch, rate, about,
// pricing) are left exactly as they are.
// ═══════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { realPathForHash } from '@/lib/real-routes'

export default function HashRedirect() {
  const router = useRouter()

  useEffect(() => {
    // Mount-only: in-site hash navigation must keep working exactly as
    // before, so this never re-runs after the initial redirect.
    const target = realPathForHash(window.location.hash)
    if (target) router.replace(target)
  }, [router])

  return null
}
