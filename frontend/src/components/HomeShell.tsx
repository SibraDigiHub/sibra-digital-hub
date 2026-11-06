'use client'

// ═══════════════════════════════════════════════════════════
// T8: client SPA shell — moved verbatim from src/app/page.tsx so
// page.tsx itself can be a SERVER component that emits the site-level
// JSON-LD (Organization + WebSite) before rendering this shell.
// Zero visual/behavioural change — same components, same hooks, same DOM.
//
// SIBRA DIGITAL HUB × DIGITAL KIDOSPHERE
// Single-route SPA shell — hash-synced views:
//   #/                      → 3D Split Gateway
//   #/shop?zone=…&category=… → Universal Catalog + signature sections
//   #/product/[slug]        → Product detail
//   #/thank-you?order=…     → Post-payment success
//   #/download/[token]      → Token-gated download landing
//   #/admin                 → Hidden console (noindex)
//   #/admin-reset?token=…   → Password-reset landing (T4-b; token stripped
//                             from the address bar immediately)
//   #/privacy|terms|refund-policy|contact
// Persistent WebGL mood scene behind everything (lazy-loaded).
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '@/store/app-store'
import Navbar from '@/components/Navbar'
import TickerBar from '@/components/TickerBar'
import Footer from '@/components/Footer'
import CursorFX from '@/components/CursorFX'
import GatewayHero from '@/components/GatewayHero'
import LegalView from '@/components/LegalView'
import DownloadView from '@/components/DownloadView'
import RateReviewView from '@/components/RateReviewView'
import { CatalogEngine } from '@/components/shop/CatalogEngine'
import { hydrateCategories } from '@/lib/categories'
import { ProductDetailView } from '@/components/shop/ProductDetailView'
import { ThankYouView } from '@/components/shop/ThankYouView'
import KidsSkyDecor from '@/components/shop/KidsSkyDecor'
import SocialFamilySection from '@/components/shop/SocialFamilySection'
import WatchView from '@/components/watch/WatchView'
import { useZoneTransitionHost } from '@/components/zone-transition'
import { installAnimVisibilityGuard } from '@/lib/anim-visibility'
import JourneySlider from '@/components/sections/JourneySlider'
import HowItWorksBento from '@/components/sections/HowItWorksBento'
import ReviewsCarousel from '@/components/sections/ReviewsCarousel'
import FAQAccordion from '@/components/sections/FAQAccordion'

const SceneCanvas = dynamic(() => import('@/components/three/SceneCanvas'), {
  ssr: false,
})
const AdminApp = dynamic(() => import('@/components/admin/AdminApp'), { ssr: false })
const AdminResetPassword = dynamic(() => import('@/components/admin/AdminResetPassword'), { ssr: false })
// Zone signature animation — the overlay shell itself is a tiny shared
// chunk; each zone's choreography is its own lazy chunk (see the kit).
const ZoneStage = dynamic(() => import('@/components/zone-transition/stage/ZoneStage'), { ssr: false })

export default function Home() {
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.zone)
  const productSlug = useAppStore((s) => s.productSlug)
  const orderId = useAppStore((s) => s.orderId)
  const hydrated = useAppStore((s) => s.hydrated)
  const hydratedRef = useRef(false)
  const [sceneReady, setSceneReady] = useState(false)
  const zoneRun = useZoneTransitionHost()
  const guardRef = useRef<ReturnType<typeof installAnimVisibilityGuard> | null>(null)

  // T4: pause off-screen infinite CSS animations (look unchanged),
  // and freeze the gateway letter-wave/blobs while the zone
  // animation owns the screen.
  useEffect(() => {
    const guard = installAnimVisibilityGuard()
    guardRef.current = guard
    return () => guard.dispose()
  }, [])

  useEffect(() => {
    guardRef.current?.setSuppressed(Boolean(zoneRun.run))
  }, [zoneRun.run])

  // ── Bootstrap: hash state, geo, sound pref, scene ─────────
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true

    const store = useAppStore.getState()
    store.hydrateFromHash()

    // Returning visitor auto-skip (session-scoped, keeps gateway on fresh visits)
    try {
      const hadZone = window.localStorage.getItem('sdh_zone')
      const enteredThisSession = window.sessionStorage.getItem('sdh_entered')
      const hash = window.location.hash
      if (!hash && hadZone && enteredThisSession) {
        store.navigate('shop', { zone: hadZone === 'creator' ? 'creator' : 'kids', category: null })
      } else if (!hash && hadZone && !enteredThisSession) {
        window.sessionStorage.setItem('sdh_entered', '1')
      }
    } catch {
      /* private mode */
    }

    // Sound preference — ON by default; only an explicit saved
    // mute ('0', or legacy 'off') silences the site.
    try {
      const sound = window.localStorage.getItem('sdh_sound')
      if (sound === '0' || sound === 'off') store.setSoundOn(false)
    } catch {
      /* ignore */
    }

    // Geo for checkout ordering (non-blocking)
    void fetch('/api/geo')
      .then((r) => r.json())
      .then((d) => store.setIsIndia(Boolean(d.isIndia)))
      .catch(() => store.setIsIndia(false))

    // T10: admin-managed category registry (single shared fetch,
    // built-in defaults render until it lands — never blocks boot)
    void hydrateCategories()

    // Mark session entered whenever navigating beyond the gateway
    const markEntered = () => {
      try {
        window.sessionStorage.setItem('sdh_entered', '1')
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('hashchange', markEntered)
    return () => window.removeEventListener('hashchange', markEntered)
  }, [])

  // Re-hydrate on browser back/forward
  useEffect(() => {
    const onPop = () => useAppStore.getState().hydrateFromHash()
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  // Lazy-load the WebGL scene after first paint (PRD §14.1)
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

  // Zone theme attribute (CSS switches with it) + canvas mood per view
  useEffect(() => {
    document.documentElement.dataset.zone =
      view === 'shop' || view === 'product' ? (zone ?? '') : ''
    const store = useAppStore.getState()
    if (view === 'shop' || view === 'product') {
      store.setCanvasMood(zone === 'creator' ? 1 : zone === 'kids' ? 0 : 0.5)
    } else {
      store.setCanvasMood(0.5) // neutral blended ambience for gateway/legal/thankyou/download
    }
  }, [view, zone])

  // Reset scroll when the view changes (SPA has no native reset)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [view, productSlug])

  const showChrome =
    view !== 'gateway' && view !== 'admin' && view !== 'admin-reset' && view !== 'watch'
  // T-V: the watch page is a standalone secured view — no navbar/ticker/footer,
  // no zone sky, dark scrim only. Nothing else on the site changes.
  const isWatch = view === 'watch'
  const isShop = view === 'shop'

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-clip">
      {/* Ambient gradient blobs behind everything */}
      <div aria-hidden className="blob left-[-10%] top-[-10%] h-[42vw] w-[42vw] bg-[#e5b842]/20" />
      <div
        aria-hidden
        className="blob bottom-[-15%] right-[-12%] h-[48vw] w-[48vw] bg-[#00f0ff]/10"
        style={{ animationDelay: '-8s' }}
      />

      {/* Persistent WebGL mood scene (fallback-aware) */}
      {sceneReady && <SceneCanvas />}

      {/* Kids Zone floating 3D sky (kids shop/product only) */}
      {(view === 'shop' || view === 'product') && zone === 'kids' && <KidsSkyDecor />}

      {/* T-V: dark scrim behind the secured watch view */}
      {isWatch && <div aria-hidden className="fixed inset-0 z-[5] bg-[#050706]/92" />}

      {/* Dark scrim behind text-heavy views so light copy stays readable
          over the ambient canvas backdrop */}
      {(view === 'legal' || view === 'download' || view === 'thankyou' || view === 'rate') && (
        <div aria-hidden className="fixed inset-0 z-[5] bg-[#050706]/75" />
      )}

      <CursorFX />
      {view !== 'admin' && view !== 'admin-reset' && view !== 'watch' && <Navbar />}

      {/* Zone signature animation — hosted here (not inside the gateway)
          so it survives the view swap at zone entry and keeps the
          final sparks/confetti falling over the settling home page. */}
      {zoneRun.run && (
        <ZoneStage
          key={`${zoneRun.run.zone}-${zoneRun.run.totalMs}`}
          zone={zoneRun.run.zone}
          tier={zoneRun.run.tier}
          profile={zoneRun.run.profile}
          totalMs={zoneRun.run.totalMs}
          heroRect={zoneRun.run.heroRect}
          onEnterZone={zoneRun.onEnterZone}
          onDone={zoneRun.onDone}
        />
      )}

      {/* Spacer that clears the floating fixed navbar so no
          content or marquee ever slides underneath it */}
      {showChrome && <div aria-hidden className="h-[72px] shrink-0" />}

      {showChrome && <TickerBar />}

      <main className="relative z-10 flex flex-1 flex-col">
        <AnimatePresence mode="wait">
          {hydrated && view === 'gateway' && (
            <motion.div
              key="gateway"
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.45 }}
            >
              <GatewayHero />
            </motion.div>
          )}

          {view === 'shop' && (
            <motion.div
              key={`shop-${zone ?? 'kids'}`}
              className="flex-1"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mx-auto w-full max-w-[1320px] px-4 pt-6 md:px-6">
                <CatalogEngine />
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
              {/* T-V Feature A — "Our YouTube Family" (current zone only;
                  renders nothing when the zone has no channels) */}
              <div className="cv-auto mt-16 md:mt-24">
                <SocialFamilySection zone={zone === 'creator' ? 'creator' : 'kids'} />
              </div>
              <div className="cv-auto mt-16 md:mt-24 mb-20">
                <FAQAccordion />
              </div>
            </motion.div>
          )}

          {view === 'product' && (
            <motion.div
              key={`product-${productSlug ?? ''}`}
              className="flex-1"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {productSlug ? (
                <ProductDetailView slug={productSlug} />
              ) : (
                <div className="grid min-h-[60dvh] place-items-center text-[#9aa89e]">Product not found.</div>
              )}
            </motion.div>
          )}

          {view === 'thankyou' && (
            <motion.div
              key="thankyou"
              className="flex-1"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <ThankYouView orderId={orderId} />
            </motion.div>
          )}

          {view === 'download' && (
            <motion.div
              key="download"
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <DownloadView />
            </motion.div>
          )}

          {/* Layer 2 — verified-purchase rate page (token in the fragment only) */}
          {view === 'rate' && (
            <motion.div
              key="rate"
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <RateReviewView />
            </motion.div>
          )}

          {/* T-V Feature C — protected watch page (token in the fragment only) */}
          {isWatch && (
            <motion.div
              key="watch"
              className="relative z-10 flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <WatchView token={useAppStore.getState().downloadToken} />
            </motion.div>
          )}

          {view === 'legal' && (
            <motion.div
              key={`legal-${useAppStore.getState().legalPage ?? 'privacy'}`}
              className="flex-1"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <LegalView />
            </motion.div>
          )}

          {view === 'admin' && (
            <motion.div
              key="admin"
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <AdminApp />
            </motion.div>
          )}

          {view === 'admin-reset' && (
            <motion.div
              key="admin-reset"
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <AdminResetPassword />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {showChrome && <Footer />}
    </div>
  )
}
