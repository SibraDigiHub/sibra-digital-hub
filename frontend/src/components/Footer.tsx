'use client'

// ═══════════════════════════════════════════════════════════
// Footer for every view except the gateway and the product
// detail page. mt-auto keeps it pinned to the viewport bottom
// inside the flex shell.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Mail, Share2, ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useChannels } from '@/lib/use-channels'
import { ChannelCard } from '@/components/shop/SocialFamilySection'

const FALLBACK_EMAIL = 'support@sibradigitalhub.com'

export default function Footer({ forceVisible = false }: { forceVisible?: boolean }) {
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.zone)
  const navigate = useAppStore((s) => s.navigate)
  const [email, setEmail] = useState(FALLBACK_EMAIL)
  // T-V Feature A — "Watch us on Social Media" column (current zone's channels;
  // hidden entirely when the zone has none — footer grid stays untouched).
  const socialChannels = useChannels(zone === 'creator' ? 'creator' : 'kids')
  const showSocial = socialChannels.length > 0

  useEffect(() => {
    let alive = true
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: { contactEmail?: string } } | null) => {
        if (!alive) return
        const e = data?.settings?.contactEmail
        if (typeof e === 'string' && e.includes('@')) setEmail(e)
      })
      .catch(() => {
        /* keep fallback */
      })
    return () => {
      alive = false
    }
  }, [])

  // Real routes pass forceVisible: the store view is still its default on
  // the server pass, but /shop and the legal pages must show the footer in
  // the first HTML (the hash SPA never passes the prop — behaviour there is
  // byte-for-byte unchanged; the product page keeps rendering no footer).
  if (!forceVisible && (view === 'gateway' || view === 'product')) return null

  const quickLinks: { label: string; action: () => void }[] = [
    { label: 'Kids Zone', action: () => navigate('shop', { zone: 'kids', category: null }) },
    { label: 'Creator Hub', action: () => navigate('shop', { zone: 'creator', category: null }) },
    { label: 'Switch World', action: () => navigate('gateway') },
    { label: 'Admin Console', action: () => navigate('admin') },
  ]

  const legalLinks: { label: string; page: string }[] = [
    { label: 'About Us', page: 'about' },
    { label: 'Pricing', page: 'pricing' },
    { label: 'Privacy Policy', page: 'privacy' },
    { label: 'Terms', page: 'terms' },
    { label: 'Refund Policy', page: 'refund-policy' },
    { label: 'Contact', page: 'contact' },
  ]

  const linkClass =
    'footer-link flex min-h-[44px] items-center gap-2 text-sm text-white transition-colors hover:text-[#00F0FF] focus-visible:outline-none'

  return (
    <footer className="site-footer mt-auto w-full border-t border-[rgba(229,184,66,0.18)] bg-black/80 text-[#F5F8F6]">
      <div className={`mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6 ${showSocial ? 'lg:grid-cols-4' : ''}`}>
        {/* Brand */}
        <div>
          <div className="flex items-center gap-2">
            <Image
              src="/brand/logo-mark.png"
              alt=""
              width={36}
              height={36}
              aria-hidden="true"
              className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_0_12px_rgba(229,184,66,0.45)]"
            />
            <span className="font-cinzel text-sm font-semibold tracking-[0.14em] text-[#E5B842]">SIBRA DIGITAL HUB</span>
          </div>
          <p className="footer-muted mt-3 text-sm text-white">Two worlds of instant digital joy.</p>
          <p className="footer-muted mt-4 flex items-center gap-2 text-xs text-white">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#E5B842]" aria-hidden="true" />
            Payments secured by Razorpay · Amazon KDP
          </p>
        </div>

        {/* Quick Links */}
        <nav aria-label="Quick links">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#E5B842]">Quick Links</h2>
          {quickLinks.map((l) => (
            <button key={l.label} type="button" onClick={l.action} className={linkClass}>
              {l.label}
            </button>
          ))}
        </nav>

        {/* Legal */}
        <nav aria-label="Legal">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#E5B842]">Legal</h2>
          {legalLinks.map((l) => (
            <button
              key={l.page}
              type="button"
              onClick={() => navigate('legal', { legalPage: l.page })}
              className={linkClass}
            >
              {l.label}
            </button>
          ))}
          <a href={`mailto:${email}`} className={linkClass}>
            <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
            {email}
          </a>
        </nav>

        {/* T-V Feature A — "Watch us on Social Media" (only when this zone has channels) */}
        {showSocial && (
          <nav aria-label="Watch us on Social Media">
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[#E5B842]">
              <Share2 className="size-3.5" aria-hidden="true" />
              Watch us on Social Media
            </h2>
            <div className="flex flex-col gap-3">
              {socialChannels.slice(0, 2).map((c) => (
                <ChannelCard key={c.id} channel={c} zone={zone === 'creator' ? 'creator' : 'kids'} compact />
              ))}
            </div>
          </nav>
        )}
      </div>

      <div className="footer-muted border-t border-white/10 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-white">
        © {new Date().getFullYear()} Sibra Digital Hub · Made with 💛 in India
      </div>
    </footer>
  )
}
