'use client'

// ═══════════════════════════════════════════════════════════
// §11.3.4 — Glass FAQ accordion + FAQPage JSON-LD for SEO.
// Fetches /api/faqs; falls back to built-in samples.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircleHeart } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { useStaggerReveal } from '@/hooks/useStaggerReveal'
import { jsonLdString } from '@/lib/json-ld'
import type { FaqItem } from '@/types/marketplace'

/** Built-in samples shown while loading or if the API fails */
const FALLBACK_FAQS: FaqItem[] = [
  {
    id: 'fb-faq-1',
    question: 'Which payment methods can I use?',
    answer:
      'Shoppers in India can pay instantly via UPI — Google Pay, PhonePe, Paytm or any UPI app — or by card or net banking through Razorpay. Everywhere else we accept international cards (and PayPal where Razorpay enables it) through Razorpay Checkout. The checkout asks you to confirm your billing country and then shows the matching payment methods.',
    sortOrder: 1,
    createdAt: '',
  },
  {
    id: 'fb-faq-2',
    question: 'How fast will I get my files?',
    answer:
      '⚡ Instant-download items land in your inbox within seconds of payment — the download link stays live for 48 hours with up to 5 downloads, and if it expires we re-send a fresh link on request. Marketplace orders (Amazon, Etsy & more) follow that platform’s standard delivery timeline.',
    sortOrder: 2,
    createdAt: '',
  },
  {
    id: 'fb-faq-3',
    question: 'What is your refund policy?',
    answer:
      'Because our goods are digital, a file can’t be “un-sent” — but we always make it right. Duplicate payments, failed downloads and wrong-file issues get a full refund or free replacement within 7 days. Just contact us with your order ID.',
    sortOrder: 3,
    createdAt: '',
  },
  {
    id: 'fb-faq-4',
    question: 'How do I print the activities?',
    answer:
      'Every pack ships as a 300 DPI PDF sized for both A4 and US Letter. Print at home on regular paper, or take the file to any local print shop — colours come out crisp on inkjet and laser alike. Tip: cardstock makes flashcards extra durable.',
    sortOrder: 4,
    createdAt: '',
  },
]

function normalizeFaq(raw: unknown, i: number): FaqItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const question = typeof o.question === 'string' ? o.question : ''
  const answer = typeof o.answer === 'string' ? o.answer : ''
  if (!question || !answer) return null
  return {
    id: typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : `api-${i}`,
    question,
    answer,
    sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : i,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
  }
}



export default function FAQAccordion() {
  const [faqs, setFaqs] = useState<FaqItem[] | null>(null)
  const sectionRef = useStaggerReveal<HTMLElement>({ deps: [faqs] })

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const res = await fetch('/api/faqs', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { faqs?: unknown }
        const raw = Array.isArray(data.faqs) ? data.faqs : []
        const list = raw
          .map(normalizeFaq)
          .filter((f): f is FaqItem => f !== null)
          .sort((a, b) => a.sortOrder - b.sortOrder)
        if (!alive) return
        setFaqs(list.length > 0 ? list : FALLBACK_FAQS)
      } catch {
        if (alive) setFaqs(FALLBACK_FAQS)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  const goToContact = useCallback(() => {
    useAppStore.getState().navigate('legal', { legalPage: 'contact' })
  }, [])

  return (
    <section
      ref={sectionRef}
      aria-labelledby="faq-heading"
      className="relative mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24"
    >
      {/* ── Section header ── */}
      <div className="reveal mx-auto max-w-3xl text-center">
        <p className="sec-eyebrow font-jetbrains text-xs font-semibold tracking-[0.3em] text-[#E5B842]">
          ── GOOD TO KNOW ──
        </p>
        <h2
          id="faq-heading"
          className="sec-heading chameleon-sweep font-playfair mt-4 text-3xl leading-tight font-semibold text-foreground md:text-5xl"
        >
          Frequently Asked <span className="holo-text">Questions</span>
        </h2>
        <p className="mt-4 text-sm text-muted-foreground md:text-base">
          Payments, delivery, refunds and printing — answered in plain words.
        </p>
      </div>

      {/* ── Glass accordion ── */}
      <div className="reveal mx-auto mt-10 max-w-3xl md:mt-14">
        <Accordion type="single" collapsible className="w-full">
          {(faqs ?? FALLBACK_FAQS).map((faq) => (
            <AccordionItem
              key={faq.id}
              value={faq.id}
              className="glass reveal mb-3 rounded-2xl border-0 px-5"
            >
              <AccordionTrigger className="py-4 text-left text-base font-semibold text-foreground hover:no-underline hover:text-primary">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/* ── Help line ── */}
        <div className="mt-8 flex justify-center">
          <Button
            type="button"
            onClick={goToContact}
            variant="outline"
            className="faq-contact min-h-[44px] gap-2 rounded-full border-[#E5B842]/40 bg-transparent px-6 font-jetbrains text-xs tracking-widest text-primary hover:bg-[#E5B842]/10 hover:text-primary"
          >
            <MessageCircleHeart aria-hidden="true" className="h-4 w-4" />
            Still curious? Contact us →
          </Button>
        </div>
      </div>

      {/* ── FAQPage structured data (SEO) ── */}
      {faqs !== null && faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            // T7 §8.5: `<` escaped as \u003c — admin-authored FAQ text can
            // never break out of the script tag.
            __html: jsonLdString({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqs.map((faq) => ({
                '@type': 'Question',
                name: faq.question,
                acceptedAnswer: { '@type': 'Answer', text: faq.answer },
              })),
            }),
          }}
        />
      )}
    </section>
  )
}
