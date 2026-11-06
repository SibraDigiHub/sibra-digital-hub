'use client'

// ═══════════════════════════════════════════════════════════
// T10 — Dynamic category hydration.
//
// Fetches the admin-managed category registry once per app boot
// and installs it into the marketplace registry (setDynamicCategories).
// Every consumer — storefront chips, product-form select, journey
// slider, label lookups — then renders admin-created categories with
// zero extra wiring.
//
// Safety rules:
//   • First render always shows the built-in defaults → no SSR
//     hydration mismatch, no blank chips if the API is slow.
//   • If the fetch fails, the built-in defaults stay → the
//     storefront can never lose its categories.
//   • Duplicate calls (HomeShell + ProductForm + …) share one
//     in-flight request.
//   • Admin mutations call refreshCategories() so the storefront
//     picks up changes immediately (same SPA tab).
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand'
import {
  CREATOR_CATEGORIES,
  KIDS_CATEGORIES,
  setDynamicCategories,
  type CategoryMeta,
  type Zone,
} from '@/types/marketplace'

interface CategoryState {
  kids: CategoryMeta[]
  creator: CategoryMeta[]
  loaded: boolean
}

const useCategoryStore = create<CategoryState>(() => ({
  kids: [],
  creator: [],
  loaded: false,
}))

interface CategoryApiRow {
  zone: string
  slug: string
  label: string
  emoji: string
  blurb: string
  sortOrder: number
  active?: boolean
}

const bySort = (a: CategoryApiRow, b: CategoryApiRow) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
const toMeta = (r: CategoryApiRow): CategoryMeta => ({
  slug: r.slug,
  label: r.label,
  emoji: r.emoji || '📦',
  blurb: r.blurb ?? '',
})

let inflight: Promise<void> | null = null

async function fetchAndInstall(): Promise<void> {
  const res = await fetch('/api/categories', { cache: 'no-store' })
  if (!res.ok) throw new Error(`categories ${res.status}`)
  const data = (await res.json().catch(() => null)) as { categories?: CategoryApiRow[] } | null
  const rows = data?.categories ?? []
  const kids = rows.filter((r) => r.zone === 'kids' && r.active !== false).sort(bySort).map(toMeta)
  const creator = rows.filter((r) => r.zone === 'creator' && r.active !== false).sort(bySort).map(toMeta)
  setDynamicCategories('kids', kids)
  setDynamicCategories('creator', creator)
  useCategoryStore.setState({ kids, creator, loaded: true })
}

/**
 * Fetch the category registry once (no-op after success).
 * Safe to call from any component effect — calls share one request.
 */
export function hydrateCategories(): Promise<void> {
  if (useCategoryStore.getState().loaded) return Promise.resolve()
  if (inflight) return inflight
  inflight = fetchAndInstall().catch(() => {
    /* API down → built-in defaults stay; next mount retries */
    inflight = null
  })
  return inflight
}

/**
 * Force a refetch (after admin create/update/delete) without ever
 * clearing the current lists — the storefront updates in place.
 */
export function refreshCategories(): Promise<void> {
  inflight = null
  useCategoryStore.setState({ loaded: false })
  return hydrateCategories()
}

/**
 * Reactive category list for a zone. Renders the built-in defaults
 * until the fetched list lands, then re-renders with live categories.
 */
export function useZoneCategories(zone: Zone): CategoryMeta[] {
  const loaded = useCategoryStore((s) => s.loaded)
  const list = useCategoryStore((s) => s[zone])
  if (!loaded || list.length === 0) return zone === 'kids' ? KIDS_CATEGORIES : CREATOR_CATEGORIES
  return list
}
