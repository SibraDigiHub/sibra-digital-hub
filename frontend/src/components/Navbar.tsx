'use client'

// ═══════════════════════════════════════════════════════════
// Floating pill glass navbar — hidden on the gateway view.
// Desktop inline links · mobile Sheet menu · SoundToggle.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Lock, Menu } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import SoundToggle from '@/components/SoundToggle'
import NavbarSocial from '@/components/shop/NavbarSocial'
import { useAppStore } from '@/store/app-store'

const LEGAL_LINKS: { label: string; page: string }[] = [
  { label: 'About Us', page: 'about' },
  { label: 'Pricing', page: 'pricing' },
  { label: 'Privacy Policy', page: 'privacy' },
  { label: 'Terms', page: 'terms' },
  { label: 'Refund Policy', page: 'refund-policy' },
  { label: 'Contact', page: 'contact' },
]

export default function Navbar() {
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.zone)
  const navigate = useAppStore((s) => s.navigate)
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (view === 'gateway') return null

  const showZoneChip = (view === 'shop' || view === 'product') && zone

  const linkClass =
    'nav-link flex min-h-[44px] items-center whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium text-[#F5F8F6]/85 transition-colors focus-visible:outline-none'

  const go = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <header
      className={`site-nav glass fixed left-1/2 top-3 z-50 flex h-14 max-w-[94vw] -translate-x-1/2 items-center gap-2 rounded-full px-4 md:gap-3 md:px-6 ${
        scrolled ? 'shadow-[0_14px_44px_rgba(0,0,0,0.55)]' : ''
      }`}
    >
      {/* Logo orb + wordmark */}
      <button
        type="button"
        onClick={() => navigate('gateway')}
        aria-label="Sibra Digital Hub — home"
        className="flex min-h-[44px] items-center gap-2 rounded-full pr-1 focus-visible:outline-none"
      >
        <Image
          src="/brand/logo-mark.png"
          alt=""
          width={36}
          height={36}
          aria-hidden="true"
          className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_0_12px_rgba(229,184,66,0.45)]"
        />
        <span
          className={`hidden whitespace-nowrap font-cinzel text-sm font-semibold tracking-[0.14em] sm:block md:text-base ${
            zone === 'kids'
              ? 'text-[#0369A1] drop-shadow-[0_0_8px_rgba(125,211,252,0.45)]'
              : 'text-[#E5B842]'
          }`}
        >
          SIBRA DIGITAL HUB
        </span>
      </button>

      {/* Zone chip */}
      {showZoneChip && (
        <span
          aria-label={`Current zone: ${zone === 'kids' ? 'Kids Zone' : 'Creator Hub'}`}
          className={`hidden rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap sm:inline-block ${
            zone === 'kids' ? 'bg-[#FFF2CC] text-[#7A4A00]' : 'border border-[#00F0FF]/40 bg-[#00F0FF]/10 text-[#00F0FF]'
          }`}
        >
          {zone === 'kids' ? '🎨 Kids Zone' : '⚡ Creator Hub'}
        </span>
      )}

      {/* Desktop links */}
      <nav aria-label="Primary" className="hidden items-center md:flex">
        <button
          type="button"
          onClick={() => navigate('shop', { zone: 'kids', category: null })}
          className={`${linkClass} hover:text-[#FFB347]`}
        >
          Kids Zone
        </button>
        <button
          type="button"
          onClick={() => navigate('shop', { zone: 'creator', category: null })}
          className={`${linkClass} hover:text-[#00F0FF]`}
        >
          Creator Hub
        </button>
        <button
          type="button"
          onClick={() => navigate('gateway')}
          className={`${linkClass} hover:text-[#E5B842]`}
        >
          Switch World
        </button>
        <button
          type="button"
          onClick={() => navigate('admin')}
          aria-label="Admin console login"
          className={`${linkClass} gap-1.5 text-[#E5B842]/70 hover:text-[#E5B842]`}
        >
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Admin
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-1 md:ml-0">
        {/* T-V Feature A — Social media channel list (icon → popover / bottom sheet) */}
        <NavbarSocial zone={zone} view={view} />
        <SoundToggle />

        {/* Mobile hamburger + Sheet */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="nav-burger grid h-11 w-11 place-items-center rounded-full text-[#F5F8F6] transition-colors hover:text-[#E5B842] focus-visible:outline-none md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 border-[rgba(229,184,66,0.25)] bg-[#0B0E0D]/95 text-[#F5F8F6]">
            <SheetHeader>
              <SheetTitle
                className={`font-cinzel tracking-wider ${zone === 'kids' ? 'text-[#7DD3FC]' : 'text-[#E5B842]'}`}
              >
                SIBRA DIGITAL HUB
              </SheetTitle>
              <SheetDescription>Two worlds of instant digital joy.</SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
              <button
                type="button"
                onClick={() => go(() => navigate('shop', { zone: 'kids', category: null }))}
                className="flex min-h-[44px] items-center rounded-xl px-3 text-left text-base font-medium hover:bg-[#FFB347]/10 hover:text-[#FFB347]"
              >
                🎨 Kids Zone
              </button>
              <button
                type="button"
                onClick={() => go(() => navigate('shop', { zone: 'creator', category: null }))}
                className="flex min-h-[44px] items-center rounded-xl px-3 text-left text-base font-medium hover:bg-[#00F0FF]/10 hover:text-[#00F0FF]"
              >
                ⚡ Creator Hub
              </button>
              <button
                type="button"
                onClick={() => go(() => navigate('gateway'))}
                className="flex min-h-[44px] items-center rounded-xl px-3 text-left text-base font-medium hover:bg-[#E5B842]/10 hover:text-[#E5B842]"
              >
                🌗 Switch World
              </button>

              <div className="my-3 border-t border-[rgba(229,184,66,0.2)]" aria-hidden="true" />

              {LEGAL_LINKS.map((l) => (
                <button
                  key={l.page}
                  type="button"
                  onClick={() => go(() => navigate('legal', { legalPage: l.page }))}
                  className="flex min-h-[44px] items-center rounded-xl px-3 text-left text-sm text-[#9AA89E] hover:text-[#FAE8A7]"
                >
                  {l.label}
                </button>
              ))}

              <div className="my-3 border-t border-[rgba(229,184,66,0.2)]" aria-hidden="true" />

              <button
                type="button"
                onClick={() => go(() => navigate('admin'))}
                className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-[#E5B842]/90 hover:bg-[#E5B842]/10 hover:text-[#E5B842]"
              >
                🔐 Admin Console
              </button>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
