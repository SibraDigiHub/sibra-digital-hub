'use client'

// ═══════════════════════════════════════════════════════════
// T-V Feature A — shared social-channel loader.
// One tiny module cache (per zone, 60s) so the navbar, the
// footer, the shop section and the thank-you card all share a
// single fetch. Failure → empty list (sections render nothing;
// the page never blocks on channels).
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import type { Channel, Zone } from '@/types/marketplace'

const CACHE_TTL_MS = 60_000
const cache = new Map<Zone, { at: number; channels: Channel[] }>()
const inflight = new Map<Zone, Promise<Channel[]>>()

export async function fetchChannels(zone: Zone): Promise<Channel[]> {
  const hit = cache.get(zone)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.channels
  const pending = inflight.get(zone)
  if (pending) return pending
  const p = fetch(`/api/channels?zone=${zone}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { channels: [] }))
    .then((d: { channels?: Channel[] }) => {
      const channels = Array.isArray(d.channels) ? d.channels : []
      cache.set(zone, { at: Date.now(), channels })
      return channels
    })
    .catch(() => [] as Channel[])
    .finally(() => inflight.delete(zone))
  inflight.set(zone, p)
  return p
}

/** React hook — returns [] until loaded; components render nothing while empty. */
export function useChannels(zone: Zone | null): Channel[] {
  const [channels, setChannels] = useState<Channel[]>(() => (zone ? cache.get(zone)?.channels ?? [] : []))

  useEffect(() => {
    let alive = true
    if (!zone) {
      // Deferred clear (keeps the effect body free of sync state writes)
      const t = setTimeout(() => {
        if (alive) setChannels([])
      }, 0)
      return () => clearTimeout(t)
    }
    // Cache hit arrives via the shared fetch below (instant promise);
    // no synchronous state writes in the effect body.
    void fetchChannels(zone).then((list) => {
      if (alive) setChannels(list)
    })
    return () => {
      alive = false
    }
  }, [zone])

  return channels
}
