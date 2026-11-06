'use client'

// ═══════════════════════════════════════════════════════════
// Global app state — SPA view router (hash-synced), zone
// memory, sound preference and geo. Single `/` route shell.
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand'
import {
  isRealLegalPage,
  parseRealPath,
  realProductPath,
  realShopPath,
} from '@/lib/real-routes'
import { realNavigate } from '@/lib/real-nav'
import type { ViewName, Zone } from '@/types/marketplace'

export interface RouteState {
  view: ViewName
  zone: Zone | null
  productSlug: string | null
  category: string | null
  search: string
  sort: string
  legalPage: string | null
  orderId: string | null
  downloadToken: string | null
  entered: boolean // gateway passed at least once this session
}

interface AppState extends RouteState {
  soundOn: boolean
  isIndia: boolean | null // null = unknown yet
  canvasMood: number // 0 = kids, 1 = creator (drives WebGL morph)
  /** True while a zone animation owns the screen — pauses SceneCanvas. */
  scenePaused: boolean
  hydrated: boolean
  navigate: (view: ViewName, params?: Partial<RouteState>, opts?: { replace?: boolean }) => void
  enterZone: (zone: Zone) => void
  setZone: (zone: Zone) => void
  setCanvasMood: (mood: number) => void
  setSoundOn: (on: boolean) => void
  setScenePaused: (paused: boolean) => void
  setIsIndia: (inIndia: boolean) => void
  hydrateFromHash: () => void
}

const ZONE_KEY = 'sdh_zone'

// ── Real-route mode (SEO foundation) ──
// The SPA experience at "/" stays hash-routed EXACTLY as before. When the
// app is on a real route (/shop, /product/…, /privacy…), navigate() emits
// REAL paths instead of hashes so in-site clicks never fall back to #/….
// Same-view navigations (search/sort/category/zone) stay local pushState
// (soft), view changes go through the injected Next-router adapter (hard,
// so metadata/SSR data follow) — falling back to soft when no adapter is
// mounted (never in practice).
function isRealRouteContext(): boolean {
  return typeof window !== 'undefined' && window.location.pathname !== '/'
}

function realPathForState(view: ViewName, s: Partial<RouteState>): string | null {
  switch (view) {
    case 'shop':
      return realShopPath(s.zone, s.category, s.search, s.sort)
    case 'product':
      return s.productSlug ? realProductPath(s.productSlug) : '/shop'
    case 'legal':
      return s.legalPage && isRealLegalPage(s.legalPage) ? `/${s.legalPage}` : null
    default:
      return null
  }
}

function buildHash(s: Partial<RouteState>): string {
  const view = s.view ?? 'gateway'
  switch (view) {
    case 'shop': {
      const p = new URLSearchParams()
      if (s.zone) p.set('zone', s.zone)
      if (s.category) p.set('category', s.category)
      if (s.search) p.set('q', s.search)
      if (s.sort && s.sort !== 'featured') p.set('sort', s.sort)
      const qs = p.toString()
      return `#/shop${qs ? `?${qs}` : ''}`
    }
    case 'product':
      return `#/product/${s.productSlug ?? ''}`
    case 'thankyou': {
      const p = new URLSearchParams()
      if (s.orderId) p.set('order', s.orderId)
      return `#/thank-you${p.toString() ? `?${p.toString()}` : ''}`
    }
    case 'admin':
      return '#/admin'
    case 'admin-reset':
      return '#/admin-reset'
    case 'legal':
      return `#/${s.legalPage ?? 'about'}`
    case 'download':
      return `#/download/${s.downloadToken ?? ''}`
    case 'watch':
      // T-V Feature C — protected watch page (token in the fragment only).
      return `#/watch/${s.downloadToken ?? ''}`
    case 'rate':
      // Layer 2 — verified-purchase rate page (order token in the fragment only).
      return `#/rate/${s.downloadToken ?? ''}`
    default:
      return '#/'
  }
}

function parseHash(hash: string): Partial<RouteState> {
  const clean = hash.replace(/^#\/?/, '')
  if (!clean) return { view: 'gateway', entered: false }
  const [path, query] = clean.split('?')
  const parts = path.split('/')
  const q = new URLSearchParams(query ?? '')
  const out: Partial<RouteState> = { entered: true }

  switch (parts[0]) {
    case 'shop':
      out.view = 'shop'
      out.zone = (q.get('zone') as Zone) || (parts[1] as Zone) || null
      out.category = q.get('category') || null
      out.search = q.get('q') || ''
      out.sort = q.get('sort') || 'featured'
      break
    case 'product':
      out.view = 'product'
      out.productSlug = parts[1] ?? null
      break
    case 'thank-you':
      out.view = 'thankyou'
      out.orderId = q.get('order') || null
      break
    case 'admin':
      out.view = 'admin'
      break
    case 'admin-reset':
      // Password-reset landing: `#/admin-reset?token=…` (token lives in the
      // FRAGMENT only — AdminResetPassword strips it from the bar at once).
      out.view = 'admin-reset'
      break
    case 'about':
    case 'pricing':
    case 'privacy':
    case 'terms':
    case 'refund-policy':
    case 'contact':
      out.view = 'legal'
      out.legalPage = parts[0]
      break
    case 'download':
      out.view = 'download'
      out.downloadToken = parts[1] ?? null
      break
    case 'watch':
      // T-V Feature C — protected watch page. Token lives in the FRAGMENT
      // only (fragments are never sent to any server / referrer).
      out.view = 'watch'
      out.downloadToken = parts[1] ?? null
      break
    case 'rate':
      // Layer 2 — verified-purchase rate page. Token lives in the FRAGMENT
      // only (fragments are never sent to any server / referrer).
      out.view = 'rate'
      out.downloadToken = parts[1] ?? null
      break
    default:
      out.view = 'gateway'
      out.entered = false
  }
  return out
}

function loadStoredZone(): Zone | null {
  if (typeof window === 'undefined') return null
  try {
    const z = window.localStorage.getItem(ZONE_KEY)
    if (z === 'kids' || z === 'creator') return z
    document.cookie.split(';').forEach((c) => {
      const [k, v] = c.trim().split('=')
      if (k === ZONE_KEY && (v === 'kids' || v === 'creator')) {
        window.localStorage.setItem(ZONE_KEY, v)
      }
    })
  } catch {
    /* ignore */
  }
  return null
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'gateway',
  zone: null,
  productSlug: null,
  category: null,
  search: '',
  sort: 'featured',
  legalPage: null,
  orderId: null,
  downloadToken: null,
  entered: false,
  // Sound is ON by default (owner request); an explicit mute in
  // localStorage ('0' or legacy 'off') is always respected.
  soundOn: true,
  isIndia: null,
  canvasMood: 0.5,
  scenePaused: false,
  hydrated: false,

  navigate: (view, params, opts) => {
    const next: Partial<RouteState> = { ...get(), view, ...params }
    const hash = buildHash(next)

    const real = isRealRouteContext()
    const realPath = real ? realPathForState(view, next) : null
    if (real) {
      if (realPath) {
        // Soft = same-view navigation only (search/sort/category/zone
        // filter state inside the shop, or a no-op legal re-select).
        // Everything else (product↔shop, product↔product, legal↔legal)
        // is a hard RSC navigation so the target page brings its own
        // metadata + SSR data.
        const soft =
          view === get().view &&
          (view === 'shop' || (view === 'legal' && next.legalPage === get().legalPage))
        if (soft) {
          // Soft: same-view filter state — local URL mirror, no RSC nav
          // (search-as-you-type must not hit the server per commit).
          if (window.location.pathname + window.location.search !== realPath) {
            if (opts?.replace) window.history.replaceState(window.history.state, '', realPath)
            else window.history.pushState(window.history.state, '', realPath)
          }
        } else {
          // Hard: view (or legal page) change — Next router navigation so
          // the target real page renders with its own metadata + SSR data.
          realNavigate(realPath)
          return
        }
      } else {
        // Target view has no real route (e.g. #/about from /privacy):
        // full navigation back to the hash SPA.
        window.location.assign(hash === '#/' ? '/' : `/${hash}`)
        return
      }
    } else if (typeof window !== 'undefined' && window.location.hash !== hash) {
      // replace: hash mirrors live filter state (search-as-you-type, sort
      // tweaks) without spamming the history stack. Default stays push so
      // zone/category clicks keep their back-button entries.
      if (opts?.replace) window.history.replaceState(null, '', hash)
      else window.history.pushState(null, '', hash)
    }
    // Persist chosen zone
    if (typeof window !== 'undefined' && next.zone) {
      window.localStorage.setItem(ZONE_KEY, next.zone)
      document.cookie = `${ZONE_KEY}=${next.zone}; path=/; max-age=2592000; samesite=lax`
    }
    set({
      view,
      zone: params?.zone !== undefined ? params.zone : get().zone,
      productSlug: params?.productSlug !== undefined ? params.productSlug : view === 'product' ? get().productSlug : null,
      category: params?.category !== undefined ? params.category : view === 'shop' ? get().category : null,
      search: params?.search !== undefined ? params.search : view === 'shop' ? get().search : '',
      sort: params?.sort !== undefined ? params.sort : view === 'shop' ? get().sort : 'featured',
      legalPage: params?.legalPage ?? (view === 'legal' ? get().legalPage : null),
      orderId: params?.orderId ?? (view === 'thankyou' ? get().orderId : null),
      downloadToken: params?.downloadToken ?? (view === 'download' || view === 'rate' ? get().downloadToken : null),
      entered: view === 'gateway' ? false : true,
    })
  },

  enterZone: (zone) => {
    set({ canvasMood: zone === 'kids' ? 0 : 1 })
    get().navigate('shop', { zone, category: null })
  },

  setZone: (zone) => {
    set({ zone, canvasMood: zone === 'kids' ? 0 : 1 })
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ZONE_KEY, zone)
      document.cookie = `${ZONE_KEY}=${zone}; path=/; max-age=2592000; samesite=lax`
    }
  },

  setCanvasMood: (mood) => set({ canvasMood: mood }),
  setSoundOn: (on) => set({ soundOn: on }),
  setScenePaused: (paused) => set({ scenePaused: paused }),
  setIsIndia: (inIndia) => set({ isIndia: inIndia }),

  hydrateFromHash: () => {
    if (typeof window === 'undefined') return
    // Real-route context: state comes from the pathname (browser
    // back/forward across real URLs after soft pushState navigations).
    if (isRealRouteContext()) {
      const parsed = parseRealPath(window.location.pathname, window.location.search)
      const storedZone = loadStoredZone()
      const zone = (parsed.zone as Zone | null) ?? storedZone
      set({
        view: parsed.kind === 'other' ? 'gateway' : parsed.kind === 'legal' ? 'legal' : parsed.kind,
        zone: parsed.kind === 'shop' || parsed.kind === 'product' ? zone : null,
        productSlug: parsed.slug,
        category: parsed.category,
        search: parsed.search,
        sort: parsed.sort,
        legalPage: parsed.legalPage,
        orderId: null,
        downloadToken: null,
        entered: true,
        hydrated: true,
        canvasMood: parsed.kind === 'shop' || parsed.kind === 'product' ? (zone === 'creator' ? 1 : 0) : 0.5,
      })
      document.documentElement.dataset.zone =
        parsed.kind === 'shop' || parsed.kind === 'product' ? (zone ?? '') : ''
      return
    }
    const parsed = parseHash(window.location.hash)
    const storedZone = loadStoredZone()
    const zone = parsed.zone ?? storedZone
    set({
      ...parsed,
      zone: zone ?? null,
      hydrated: true,
      canvasMood: parsed.view === 'shop' ? (zone === 'creator' ? 1 : zone === 'kids' ? 0 : 0.5) : parsed.view === 'admin' ? 0.5 : 0.5,
    })
    // Apply zone theme attribute for CSS
    if (parsed.view === 'shop' || parsed.view === 'product') {
      document.documentElement.dataset.zone = zone ?? ''
    } else {
      document.documentElement.dataset.zone = ''
    }
  },
}))

/** Helper: parse JSON-string columns returned by API rows.
 *  Implementation lives in @/lib/parse-product (shared with server
 *  SEO helpers — this module is 'use client', so server components
 *  must import the lib module directly). */
export { parseProduct } from '@/lib/parse-product'
