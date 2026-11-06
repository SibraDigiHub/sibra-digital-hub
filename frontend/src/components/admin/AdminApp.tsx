'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Control Room root view. Session gate, sidebar shell
// (desktop) / top tabs (mobile). Always dark glass, independent
// of the site zone: forces html[data-zone=''] on mount.
// T4-b auth flow: session probe on boot returns the stage —
//   no session          → Login (email + password)
//   PENDING_2FA session → second-factor step
//   ENROLL session      → first-time security setup
//   FULL session        → the console
// Any 401 from the shared admin client drops back to Login.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import {
  Activity,
  ArrowLeft,
  LayoutDashboard,
  Loader2,
  LogOut,
  Package,
  ReceiptText,
  ServerCog,
  Settings,
  Star,
  Tags,
  Users,
  Share2,
} from 'lucide-react'

import { useAppStore } from '@/store/app-store'
import type { ProductRow } from '@/types/marketplace'
import {
  adminFetch,
  fetchAdminSession,
  onAdminUnauthorized,
  type AdminSecurityInfo,
  type AdminSessionInfo,
} from '@/lib/admin-api'

import Admin2FA from '@/components/admin/Admin2FA'
import AdminActivity from '@/components/admin/AdminActivity'
import AdminCategories from '@/components/admin/AdminCategories'
import AdminChannels from '@/components/admin/AdminChannels'
import AdminCustomers from '@/components/admin/AdminCustomers'
import AdminDashboard from '@/components/admin/AdminDashboard'
import AdminEnroll from '@/components/admin/AdminEnroll'
import AdminLogin from '@/components/admin/AdminLogin'
import AdminOrders from '@/components/admin/AdminOrders'
import AdminProducts from '@/components/admin/AdminProducts'
import AdminReviews from '@/components/admin/AdminReviews'
import AdminSettings from '@/components/admin/AdminSettings'
import AdminSystem from '@/components/admin/AdminSystem'
import ProductForm from '@/components/admin/ProductForm'

export type AdminTab =
  | 'dashboard'
  | 'products'
  | 'categories'
  | 'channels'
  | 'orders'
  | 'customers'
  | 'reviews'
  | 'activity'
  | 'system'
  | 'settings'

const NAV: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'channels', label: 'Social Media', icon: Share2 },
  { id: 'orders', label: 'Orders', icon: ReceiptText },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'reviews', label: 'Reviews', icon: Star },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'system', label: 'System', icon: ServerCog },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function AdminApp() {
  const navigate = useAppStore((s) => s.navigate)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<AdminSessionInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [listKey, setListKey] = useState(0)

  const refreshSession = useCallback(async () => {
    const info = await fetchAdminSession()
    setSession(info.authenticated ? info : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.zone = ''
    let alive = true
    // Session probe on boot (async: setState only in the callback).
    fetchAdminSession()
      .then((info) => {
        if (!alive) return
        setSession(info.authenticated ? info : null)
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    // Session expired (idle/absolute timeout, revoked elsewhere, password
    // changed…) → any 401 lands back on the login screen.
    const unsubscribe = onAdminUnauthorized(() => setSession(null))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  function signOutLocally(message?: string) {
    setFormOpen(false)
    setEditing(null)
    setTab('dashboard')
    setSession(null)
    setNotice(message ?? null)
  }

  async function handleLogout() {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) })
    } catch {
      /* cookie is cleared server-side anyway */
    }
    signOutLocally()
  }

  function openEditor(product: ProductRow | null) {
    setEditing(product)
    setFormOpen(true)
  }

  function handleFormDone(saved: boolean) {
    setFormOpen(false)
    setEditing(null)
    if (saved) {
      setTab('products')
      setListKey((k) => k + 1)
    }
  }

  if (loading) {
    return (
      <div className="relative z-10 flex min-h-screen items-center justify-center bg-[#07090B] text-[#F5F8F6]">
        <Loader2 className="size-8 animate-spin text-[#E5B842]" aria-label="Loading admin" />
      </div>
    )
  }

  const stage = session?.stage ?? null

  if (!session) {
    return (
      <div className="relative z-10 min-h-screen bg-[#07090B] text-[#F5F8F6]">
        <AdminLogin notice={notice} onSuccess={() => void refreshSession()} onStage={() => void refreshSession()} />
      </div>
    )
  }

  if (stage === 'PENDING_2FA') {
    return (
      <div className="relative z-10 min-h-screen bg-[#07090B] text-[#F5F8F6]">
        <Admin2FA
          email={session.user?.email ?? null}
          onVerified={() => void refreshSession()}
          onCancel={() => signOutLocally()}
        />
      </div>
    )
  }

  if (stage === 'ENROLL') {
    return (
      <div className="relative z-10 min-h-screen bg-[#07090B] text-[#F5F8F6]">
        <AdminEnroll
          email={session.user?.email ?? null}
          // The restricted ENROLL session cannot open the console — a fresh
          // sign-in with the new second factor is required (backend rule).
          onDone={() =>
            signOutLocally('Security setup complete — sign in with your new second factor')
          }
          onCancel={async () => {
            try {
              await adminFetch('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) })
            } catch {
              /* ignore */
            }
            signOutLocally()
          }}
        />
      </div>
    )
  }

  const security: AdminSecurityInfo | null = session.security ?? null

  return (
    <div className="relative z-10 min-h-screen bg-[#07090B] text-[#F5F8F6]">
      <div className="flex">
        {/* ── Desktop sidebar ── */}
        <aside className="glass sticky top-4 m-4 hidden h-[calc(100vh-2rem)] w-56 shrink-0 flex-col rounded-2xl p-4 md:flex">
          <div className="flex items-center gap-2.5 px-1 py-2">
            <Image
              src="/brand/logo-mark.png"
              alt=""
              width={32}
              height={32}
              aria-hidden="true"
              className="size-8 shrink-0 object-contain drop-shadow-[0_0_12px_rgba(229,184,66,0.5)]"
            />
            <span className="font-cinzel text-[13px] leading-tight tracking-wide text-[#E5B842]">
              SDH · CONTROL ROOM
            </span>
          </div>

          <nav className="mt-4 flex flex-col gap-1" aria-label="Admin sections">
            {NAV.map((item) => {
              const active = tab === item.id && !formOpen
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id)
                    setFormOpen(false)
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                    active
                      ? 'border border-[#E5B842]/30 bg-[#E5B842]/15 font-semibold text-[#E5B842]'
                      : 'text-[#9AA89E] hover:bg-white/5 hover:text-[#F5F8F6]'
                  }`}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              )
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => navigate('gateway')}
              className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-[#9AA89E] transition-colors hover:bg-white/5 hover:text-[#F5F8F6]"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Site
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-[#9AA89E] transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Logout
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 px-4 py-4 md:px-6 md:py-6">
          {/* Mobile header + tabs */}
          <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-white/10 bg-[#07090B]/90 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex items-center justify-between">
              <span className="font-cinzel text-[13px] tracking-wide text-[#E5B842]">SDH · CONTROL ROOM</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => navigate('gateway')}
                  aria-label="Back to site"
                  className="flex size-10 items-center justify-center rounded-lg text-[#9AA89E] hover:bg-white/5 hover:text-[#F5F8F6]"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  aria-label="Log out"
                  className="flex size-10 items-center justify-center rounded-lg text-[#9AA89E] hover:bg-red-500/10 hover:text-red-300"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {NAV.map((item) => {
                const active = tab === item.id && !formOpen
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id)
                      setFormOpen(false)
                    }}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[#E5B842] font-semibold text-black'
                        : 'border border-white/15 text-[#9AA89E] hover:text-[#F5F8F6]'
                    }`}
                  >
                    <item.icon className="size-3.5" aria-hidden="true" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          {formOpen ? (
            <ProductForm product={editing} onDone={handleFormDone} />
          ) : (
            <>
              {tab === 'dashboard' && <AdminDashboard onNavigate={setTab} onUnauthenticated={() => setSession(null)} />}
              {tab === 'products' && <AdminProducts key={listKey} onEditProduct={openEditor} />}
              {tab === 'categories' && <AdminCategories />}
              {tab === 'channels' && <AdminChannels />}
              {tab === 'orders' && <AdminOrders />}
              {tab === 'customers' && <AdminCustomers />}
              {tab === 'reviews' && <AdminReviews />}
              {tab === 'activity' && <AdminActivity />}
              {tab === 'system' && <AdminSystem />}
              {tab === 'settings' && (
                <AdminSettings security={security} onSecurityChanged={() => void refreshSession()} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
