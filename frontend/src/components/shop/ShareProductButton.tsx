'use client'

// ═══════════════════════════════════════════════════════════
// ShareProductButton — one share action, three surfaces (kids
// card, creator card, detail page). Uses the Web Share API
// when the platform offers it; everywhere else it copies the
// product's shareable link and confirms with a toast. Styling
// is fully caller-supplied so each surface keeps its own
// design language.
// ═══════════════════════════════════════════════════════════

import { Share2 } from 'lucide-react'
import type { Product } from '@/types/marketplace'
import { useToast } from '@/hooks/use-toast'
import { playFx } from '@/lib/sound-fx'
import { cn } from '@/lib/utils'

/** The shareable product link — `#/product/[slug]`, the same hash the SPA hydrates on load. */
export function productShareUrl(slug: string): string {
  return `${window.location.origin}${window.location.pathname}#/product/${encodeURIComponent(slug)}`
}

export function ShareProductButton({
  product,
  className,
  iconClassName,
  ariaLabel,
}: {
  product: Pick<Product, 'slug' | 'title'>
  className?: string
  iconClassName?: string
  ariaLabel?: string
}) {
  const { toast } = useToast()

  const onShare = async () => {
    const url = productShareUrl(product.slug)
    playFx('pop')
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: product.title, url })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        // platform refused the native sheet — fall through to the clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast({
        title: 'Link copied 🔗',
        description: `Share "${product.title}" — anyone with the link opens this page directly.`,
      })
    } catch {
      toast({ title: 'Copy this link 🔗', description: url })
    }
  }

  return (
    <button
      type="button"
      // Cards open the detail page on tap — sharing must not trigger that.
      onClick={(e) => {
        e.stopPropagation()
        void onShare()
      }}
      aria-label={ariaLabel ?? `Share ${product.title}`}
      title={ariaLabel ?? `Share ${product.title}`}
      className={cn('cursor-pointer', className)}
    >
      <Share2 className={cn('size-4', iconClassName)} aria-hidden="true" />
    </button>
  )
}
