'use client'

// ═══════════════════════════════════════════════════════════
// Real-route shell (SEO foundation) — the client chrome + view
// switch for /shop, /category/…, /product/… and the real legal
// pages. It renders the SAME components as the hash SPA shell
// (HomeShell), seeded from the server page so the first HTML
// already carries the real content.
//
// The hash experience at "/" is untouched: HomeShell keeps its own
// chrome; this shell exists only for real routes.
//
// Store seeding happens client-side (useLayoutEffect): the server
// pass renders the view from the `initial` data props directly, so
// no shared zustand state is touched during SSR (no cross-request
// leakage). Chrome that reads the store (Navbar/TickerBar) falls
// back to defaults on the server pass and settles at hydration.
// ═══════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/store/app-store'
import { setRealNavigate } from '@/lib/real-nav'
import type { RealLegalPage } from '@/lib/real-routes'
import type { CatalogInitialData } from '@/components/shop/CatalogEngine'
import type { Zone } from '@/types/marketplace'
import Navbar from '@/components/Navbar'
import TickerBar from '@/components/TickerBar'
import Footer from '@/components/Footer'
import CursorFX from '@/components/CursorFX'
import LegalView from '@/components/LegalView'
import { CatalogEngine } from '@/components/shop/CatalogEngine'
import { ProductDetailView, type DetailState } from '@/components/shop/ProductDetailView'
import KidsSkyDecor from '@/components/shop/KidsSkyDecor'
import SocialFamilySection from '@/components/shop/SocialFamilySection'

// Below-the-fold shop sections load lazily on real routes (same look once
// hydrated; keeps the real routes' eager payload at/below the hash SPA's).
const JourneySlider = dynamic(() => import('@/components/sections/JourneySlider'))
const HowItWorksBento = dynamic(() => import('@/components/sections/HowItWorksBento'))
const ReviewsCarousel = dynamic(() => import('@/components/sections/ReviewsCarousel'))
const FAQAccordion = dynamic(() => import('@/components/sections/FAQAccordion'))

const SceneCanvas = dynamic(() => import('@/components/three/SceneCanvas'), {
  ssr: false,
})

export type RealView = 'shop' | 'product' | 'legal'

interface RealRouteShellProps {
  view: RealView
  zone?: Zone | null
  productSlug?: string | null
  category?: string | null
  legalPage?: RealLegalPage
  search?: string
  sort?: string
  /** Server-fetched catalog seed (shop + category pages). */
  catalog?: CatalogInitialData
  /** Server-fetched product seed (product pages). */
  detail?: DetailState
  /** Product pages render no footer (existing site rule). */
  showFooter: boolean
}

export default function RealRouteShell({
  view,
  zone = null,
  productSlug = null,
  category = null,
  legalPage,
  search = '',
  sort = 'featured',
  catalog,
  detail,
  showFooter,
}: RealRouteShellProps) {
  const router = useRouter()
  const storeView = useAppStore((s) => s.view)
  const storeZone = useAppStore((s) => s.zone)
  const storeProductSlug = useAppStore((s) => s.productSlug)
  const storeLegalPage = useAppStore((s) => s.legalPage)
  const [sceneReady, setSceneReady] = useState(false)
  const seededRef = useRef(false)

  // Register the Next-router adapter so store.navigate() performs real
  // RSC navigations for cross-view clicks (cards, breadcrumbs, zones).
  useEffect(() => {
    setRealNavigate((path) => void router.push(path))
  }, [router])

  // Seed the store once per page mount (client only) — the SPA store then
  // mirrors exactly the state the hash SPA would have had on this view.
  useLayoutEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    try {
      const sound = window.localStorage.getItem('sdh_sound')
      if (sound === '0' || sound === 'off') useAppStore.getState().setSoundOn(false)
    } catch {
      /* private mode */
    }
    useAppStore.setState({
      view,
      zone,
      productSlug,
      category,
      search,
      sort,
      legalPage: legalPage ?? null,
      orderId: null,
      downloadToken: null,
      entered: true,
      hydrated: true,
      canvasMood: view === 'shop' || view === 'product' ? (zone === 'creator' ? 1 : 0) : 0.5,
    })
    document.documentElement.dataset.zone = view === 'shop' || view === 'product' ? (zone ?? '') : ''
  }, [view, zone, productSlug, category, legalPage, search, sort])

  // Browser back/forward across soft (pushState) navigations — the Next
  // router does not know about those entries, the store re-parses them.
  useEffect(() => {
    const onPop = () => useAppStore.getState().hydrateFromHash()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Zone theme attribute follows the live store view (soft navs can swap
  // category/zone in place — same behaviour as the hash shell).
  useEffect(() => {
    document.documentElement.dataset.zone =
      storeView === 'shop' || storeView === 'product' ? (storeZone ?? '') : ''
    useAppStore
      .getState()
      .setCanvasMood(
        storeView === 'shop' || storeView === 'product'
          ? storeZone === 'creator'
            ? 1
            : 0
          : 0.5,
      )
  }, [storeView, storeZone])

  // Lazy-load the WebGL scene after first paint (same as HomeShell).
  useEffect(() => {
    let cancelled = false
    const load = () => {
      if (!cancelled) setSceneReady(true)
    }
    if ('requestIdleCallback' in window) {
      ;(window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(load)
    } else {
      const t = setTimeout(load, 350)
      return () => clearTimeout(t)
    }
    return () => {
      cancelled = true
    }
  }, [])

  // The view the store currently shows — soft navigations can swap it in
  // place exactly like the hash SPA does.
  const activeView = storeView === 'shop' || storeView === 'product' || storeView === 'legal' ? storeView : view
  const activeSlug = storeView === 'product' ? (storeProductSlug ?? productSlug) : productSlug
  const activeLegal = storeView === 'legal' ? ((storeLegalPage as RealLegalPage | null) ?? legalPage) : legalPage
  const activeZone: Zone = (storeZone ?? zone ?? 'kids') as Zone

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-clip">
      {/* Ambient gradient blobs behind everything (same as HomeShell) */}
      <div aria-hidden className="blob left-[-10%] top-[-10%] h-[42vw] w-[42vw] bg-[#e5b842]/20" />
      <div
        aria-hidden
        className="blob bottom-[-15%] right-[-12%] h-[48vw] w-[48vw] bg-[#00f0ff]/10"
        style={{ animationDelay: '-8s' }}
      />

      {sceneReady && <SceneCanvas />}

      {/* Kids Zone floating 3D sky (kids shop/product only) */}
      {(activeView === 'shop' || activeView === 'product') && activeZone === 'kids' && <KidsSkyDecor />}

      {/* Dark scrim behind the text-heavy legal view */}
      {activeView === 'legal' && <div aria-hidden className="fixed inset-0 z-[5] bg-[#050706]/75" />}

      <CursorFX />
      <Navbar />

      {/* Spacer that clears the floating fixed navbar */}
      <div aria-hidden className="h-[72px] shrink-0" />

      <TickerBar />

      <main className="relative z-10 flex flex-1 flex-col">
        {activeView === 'shop' && (
          <div className="flex-1">
            <div className="mx-auto w-full max-w-[1320px] px-4 pt-6 md:px-6">
              <CatalogEngine initial={catalog} />
            </div>
            <div className="cv-auto mt-16 md:mt-24">
              <JourneySlider />
            </div>
            <div className="cv-auto mt-16 md:mt-24">
              <HowItWorksBento />
            </div>
            <div className="cv-auto mt-16 md:mt-24">
              <ReviewsCarousel />
            </div>
            <div className="cv-auto mt-16 md:mt-24">
              <SocialFamilySection zone={activeZone === 'creator' ? 'creator' : 'kids'} />
            </div>
            <div className="cv-auto mt-16 md:mt-24 mb-20">
              <FAQAccordion />
            </div>
          </div>
        )}

        {activeView === 'product' && (
          <div className="flex-1">
            {activeSlug ? (
              <ProductDetailView key={activeSlug} slug={activeSlug} initial={detail} realLinks />
            ) : (
              <div className="grid min-h-[60dvh] place-items-center text-[#9aa89e]">Product not found.</div>
            )}
          </div>
        )}

        {activeView === 'legal' && (
          <div className="flex-1">
            <LegalView pageId={activeLegal ?? undefined} />
          </div>
        )}
      </main>

      {showFooter && <Footer forceVisible />}
    </div>
  )
}
