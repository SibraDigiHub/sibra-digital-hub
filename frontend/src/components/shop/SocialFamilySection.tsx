'use client'

// ═══════════════════════════════════════════════════════════
// T-V Feature A — "Our Social Media Family" storefront section.
//
// • Shows the CURRENT ZONE's channels only (server filters by
//   zone; an empty list renders NOTHING — no empty box).
// • Cards: our own logo + platform icon + name + handle + short
//   description + a plain link to the platform. NO embeds, NO
//   widgets, NO third-party scripts — the site stays free of
//   third-party trackers.
// • YouTube CTAs append ?sub_confirmation=1 (brief §A); every
//   platform opens in a new tab with noopener.
// • Kids zone: the tiny "Ask a grown-up" check runs first and
//   is remembered for the browser session only.
// • Design follows the zone: soft playful (kids) vs neon glass
//   (creator). Swipeable row on phones, comfortable grid on
//   desktop. Keyboard-friendly, reduced-motion aware.
// ═══════════════════════════════════════════════════════════

import { useCallback, useState } from 'react'
import { ExternalLink, Share2 } from 'lucide-react'
import type { Channel, Zone } from '@/types/marketplace'
import { useChannels } from '@/lib/use-channels'
import { platformLabel } from '@/lib/social-platforms'
import GrownUpGate, { isGrownUpOk } from '@/components/shop/GrownUpGate'
import PlatformGlyph from '@/components/shop/PlatformGlyph'
import { cn } from '@/lib/utils'

/** YouTube subscribe-confirmation URL — safe append, new tab.
 *  Other platforms open the stored URL exactly as saved. */
function channelOutUrl(channel: Channel): string {
  if (channel.platform !== 'youtube') return channel.url
  try {
    const u = new URL(channel.url)
    if (!u.searchParams.has('sub_confirmation')) u.searchParams.set('sub_confirmation', '1')
    return u.toString()
  } catch {
    return channel.url
  }
}

function ChannelLogo({ channel, size }: { channel: Channel; size: 'md' | 'lg' }) {
  const px = size === 'lg' ? 'size-16 md:size-20' : 'size-12'
  if (channel.logo) {
    return (
      <img
        src={channel.logo}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className={cn(px, 'shrink-0 rounded-2xl object-contain ring-1 ring-black/5')}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(px, 'grid shrink-0 place-items-center rounded-2xl bg-[#FF0000]/10 text-[#FF0000]')}
    >
      <PlatformGlyph platform={channel.platform} className="size-1/2" />
    </span>
  )
}

export function ChannelCard({ channel, zone, compact }: { channel: Channel; zone: Zone; compact?: boolean }) {
  const kids = zone === 'kids'
  const [gateOpen, setGateOpen] = useState(false)

  const openChannel = useCallback(
    (channel: Channel) => {
      window.open(channelOutUrl(channel), '_blank', 'noopener,noreferrer')
    },
    [],
  )

  const onCtaClick = useCallback(() => {
    // Kids safety rule: ask once per browser session before leaving.
    if (kids && !isGrownUpOk()) {
      setGateOpen(true)
      return
    }
    openChannel(channel)
  }, [channel, kids, openChannel])

  return (
    <div
      className={cn(
        'group relative flex w-[260px] shrink-0 snap-center flex-col gap-3 rounded-3xl p-4 transition-transform duration-200 sm:w-auto',
        kids
          ? 'border-2 border-[#FFD98E]/80 bg-[#FFF8E7] shadow-[0_10px_30px_rgba(255,179,71,0.18)] hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(255,179,71,0.28)]'
          : 'border border-[#00F0FF]/25 bg-[#0B0E0D]/70 shadow-[0_0_24px_rgba(0,240,255,0.08)] backdrop-blur-md hover:-translate-y-1 hover:border-[#00F0FF]/50 hover:shadow-[0_0_34px_rgba(0,240,255,0.18)]',
        compact && 'p-3',
      )}
    >
      <div className="flex items-start gap-3">
        <ChannelLogo channel={channel} size={compact ? 'md' : 'lg'} />
        <div className="min-w-0">
          <h3
            className={cn(
              'truncate font-baloo font-extrabold leading-tight',
              kids ? 'text-[#7A4A00]' : 'text-[#F5F8F6]',
              compact ? 'text-sm' : 'text-base md:text-lg',
            )}
          >
            {channel.name}
          </h3>
          {channel.handle && (
            <p className={cn('truncate font-mono text-[11px]', kids ? 'text-[#A06A1F]' : 'text-[#9AA89E]')}>
              @{channel.handle}
            </p>
          )}
          {channel.audienceTag && (
            <span
              className={cn(
                'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                kids ? 'bg-[#FFE7B3] text-[#7A4A00]' : 'border border-[#00F0FF]/40 text-[#00F0FF]',
              )}
            >
              {channel.audienceTag}
            </span>
          )}
        </div>
      </div>

      {channel.description && (
        <p className={cn('line-clamp-2 text-xs leading-relaxed', kids ? 'text-[#7A4A00]/85' : 'text-[#9AA89E]')}>
          {channel.description}
        </p>
      )}

      {gateOpen && kids ? (
        <GrownUpGate
          compact
          channelName={channel.name}
          className="animate-in"
          onPass={() => {
            setGateOpen(false)
            openChannel(channel)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onCtaClick}
          className={cn(
            'mt-auto flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2.5 font-baloo text-sm font-extrabold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            kids
              ? 'bg-gradient-to-r from-[#FFB347] to-[#E58E1A] text-white shadow-[0_6px_18px_rgba(229,142,26,0.4)] hover:shadow-[0_8px_24px_rgba(229,142,26,0.55)] focus-visible:ring-[#E58E1A]'
              : 'border border-[#FF0000]/60 bg-[#FF0000]/10 text-[#FF6B6B] hover:bg-[#FF0000]/20 focus-visible:ring-[#FF0000]',
          )}
          aria-label={`${channel.buttonText} — ${channel.name} (opens ${platformLabel(channel.platform)} in a new tab)`}
        >
          <PlatformGlyph platform={channel.platform} className="size-4" />
          {channel.buttonText}
          <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** The storefront section — current zone's channels, or nothing. */
export default function SocialFamilySection({ zone }: { zone: Zone }) {
  const channels = useChannels(zone)
  if (channels.length === 0) return null // "if a zone has no channel, show nothing"

  const kids = zone === 'kids'

  return (
    <section
      id="social-family"
      aria-labelledby="social-family-title"
      className="mx-auto w-full max-w-[1320px] scroll-mt-24 px-4 md:px-6"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-[32px] p-6 md:p-10',
          kids
            ? 'border-2 border-[#FFD98E]/70 bg-gradient-to-br from-[#FFF8E7] via-[#FFF3D6] to-[#FFEBC2]'
            : 'border border-[#00F0FF]/20 bg-gradient-to-br from-[#0B0E0D]/80 via-[#0B0E0D]/60 to-[#04100E]/80 backdrop-blur-md',
        )}
      >
        <div className="mb-6 flex flex-col items-start gap-2 md:mb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p
              className={cn(
                'font-mono text-[10px] font-bold uppercase tracking-[0.25em]',
                kids ? 'text-[#E58E1A]' : 'text-[#00F0FF]',
              )}
            >
              {kids ? '🎨 Kids Zone · Sing & learn' : '⚡ Creator Hub · Build & grow'}
            </p>
            <h2
              id="social-family-title"
              className={cn(
                'font-baloo text-2xl font-extrabold md:text-3xl',
                kids ? 'text-[#7A4A00]' : 'text-[#F5F8F6]',
              )}
            >
              Our Social Media Family
            </h2>
            <p className={cn('mt-1 max-w-xl text-sm', kids ? 'text-[#7A4A00]/80' : 'text-[#9AA89E]')}>
              {kids
                ? 'Rhymes, stories and happy learning — follow our free videos on social media!'
                : 'Free walkthroughs, tooling tips and build logs from our channels.'}
            </p>
          </div>
          <span
            aria-hidden="true"
            className={cn(
              'grid size-12 place-items-center rounded-2xl',
              kids ? 'bg-[#FF0000]/10 text-[#FF0000]' : 'border border-[#FF0000]/40 text-[#FF6B6B]',
            )}
          >
            <Share2 className="size-6" />
          </span>
        </div>

        {/* Phones: horizontal swipe · Desktop: roomy grid */}
        <div className="cv-auto -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scrollbar-thin md:mx-0 md:grid md:snap-none md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} zone={zone} />
          ))}
        </div>
      </div>
    </section>
  )
}
