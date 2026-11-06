// ═══════════════════════════════════════════════════════════
// About Us content — who runs {{businessName}}, what it sells
// and how a purchase works. Facts mirror the privacy "Who we
// are" section, the refund/delivery page and llms.txt; no
// unverified business claims are made here.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const ABOUT_PAGE: LegalPageData = {
  id: 'about',
  title: 'About Us',
  tagline:
    'Who is behind {{businessName}} — and what this storefront is all about.',
  icon: 'sparkles',
  sections: [
    {
      id: 'who-we-are',
      title: 'Who we are',
      blocks: [
        {
          kind: 'p',
          text: '{{businessName}} is an independent, two-zone digital storefront — a Kids Zone curated for families and a Creator Hub built for designers, developers and job-seekers. Every product is an instant digital download.',
        },
        {
          kind: 'list',
          items: [
            'Business: {{businessName}}',
            'Owner and operator: {{ownerName}}',
            'Contact and grievances: {{email}}',
          ],
        },
        {
          kind: 'p',
          text: 'We keep the store small on purpose: every product is prepared, checked and delivered by us — so support is a real person answering your e-mail, not a ticket queue.',
        },
      ],
    },
    {
      id: 'what-we-sell',
      title: 'What we sell',
      blocks: [
        {
          kind: 'p',
          text: 'Two zones, one idea — premium digital files you can download and use the same minute you pay:',
        },
        {
          kind: 'list',
          items: [
            '🎨 Kids Zone (Digital Kidosphere) — colouring books, activity & puzzle packs, story e-books, tracing and flashcard printables, and parents’ guides',
            '⚡ Creator & Developer Hub — Canva templates, AI prompt packs, motion assets, scripts & automations, website UI kits and ATS-ready resume templates',
          ],
        },
        {
          kind: 'p',
          text: 'Everything is digital. Nothing is shipped, so there is no delivery address to wait for — your file link arrives by e-mail right after payment.',
        },
      ],
    },
    {
      id: 'how-buying-works',
      title: 'How buying works',
      blocks: [
        {
          kind: 'list',
          items: [
            '1. Pick a product — the page shows the full price in ₹ and $ before you click',
            '2. Pay securely — Razorpay Checkout handles Indian payments (UPI, cards, net banking) and international payments in USD',
            '3. Payment verified — the moment your payment is confirmed, delivery starts automatically',
            '4. Instant delivery — a secure download link is e-mailed to you (usually within seconds) and also shown on the thank-you page',
            '5. The link works for 48 hours with up to 5 downloads — and we renew expired links free for genuine buyers',
          ],
        },
        {
          kind: 'callout',
          tone: 'mint',
          icon: 'lock',
          title: 'Your payment stays with the processor',
          text: 'Card numbers, UPI PINs and bank logins never touch our servers — Razorpay Checkout collects them on its own secure pages.',
        },
      ],
    },
    {
      id: 'where-we-sell',
      title: 'Where we sell',
      blocks: [
        {
          kind: 'p',
          text: 'This website is our direct store — prices, delivery and support here are handled entirely by {{businessName}}.',
        },
        {
          kind: 'p',
          text: 'Selected products are also listed on partner marketplaces — Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books and Gumroad. On those platforms the marketplace is the seller of record: their prices, delivery and policies apply there.',
        },
      ],
    },
    {
      id: 'our-promise',
      title: 'Our promise',
      blocks: [
        {
          kind: 'list',
          items: [
            'Instant, verifiable delivery for every direct purchase',
            'Honest support — write to {{email}} and a human replies',
            'Data minimalism — we collect only what a delivery needs (see the Privacy Policy)',
            'Fair refunds — unused orders are refunded; wrong, corrupt, duplicate or undelivered files are fixed or refunded within 7 days',
          ],
        },
      ],
    },
    {
      id: 'talk-to-us',
      title: 'Talk to us',
      blocks: [
        {
          kind: 'p',
          text: 'Questions about the store, a product or a bulk licence for your school or team? We answer every e-mail.',
        },
        {
          kind: 'mail-card',
          subject: 'About {{businessName}}',
          label: 'Email us',
          body: 'Hello {{businessName}} team,\n\nMy question:\n\nThank you,',
        },
      ],
    },
  ],
}
