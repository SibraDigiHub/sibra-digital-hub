// ═══════════════════════════════════════════════════════════
// Pricing Details content — how prices work, what they include
// and the live catalog price list (rendered by LegalPriceList).
// Payment wording mirrors Terms → "Prices and taxes".
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const PRICING_PAGE: LegalPageData = {
  id: 'pricing',
  title: 'Pricing Details',
  tagline:
    'Every price on {{businessName}} — one-time, transparent, shown before you pay.',
  icon: 'tag',
  showPriceList: true,
  sections: [
    {
      id: 'how-pricing-works',
      title: 'How pricing works',
      blocks: [
        {
          kind: 'p',
          text: 'Every product on {{businessName}} is a one-time purchase. There are no subscriptions, no recurring charges and no hidden fees — the price you see on the product page is the price you pay at checkout.',
        },
        {
          kind: 'list',
          items: [
            'Prices are set per product and shown in ₹ (INR) and $ (USD) on every product card and product page',
            'Direct purchases are charged in Indian Rupees (₹) through Razorpay for customers in India',
            'Customers outside India are charged in US dollars (USD) through Razorpay Checkout — the exact USD total is shown at checkout before you pay',
            'Applicable taxes are included where indicated or added at checkout where required',
          ],
        },
      ],
    },
    {
      id: 'what-price-includes',
      title: 'What the price includes',
      blocks: [
        {
          kind: 'list',
          items: [
            'The complete files listed under “What’s inside” on the product page',
            'Instant delivery — a secure download link by e-mail the moment your payment is confirmed (48 hours, up to 5 downloads)',
            'Free link renewal for genuine buyers whose link expires',
            'The usage licence stated on the product page',
            'Support from a real person — write to {{email}} with your order ID',
          ],
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'info',
          title: 'No surprises at checkout',
          text: 'The full amount is shown before payment opens — the payment page (Razorpay Checkout) never adds charges of ours.',
        },
      ],
    },
    {
      id: 'price-changes',
      title: 'Price changes and offers',
      blocks: [
        {
          kind: 'p',
          text: 'Product prices may change, and launch offers or discounts may run from time to time. The price displayed at the moment you pay is the one that applies to your order — earlier catalog prices do not apply retroactively to completed purchases.',
        },
        {
          kind: 'p',
          text: 'Bought through a partner marketplace (Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books or Gumroad)? That platform sets and collects its own price — their pricing, taxes and offers apply there.',
        },
      ],
    },
    {
      id: 'live-price-list',
      title: 'Live price list',
      blocks: [
        {
          kind: 'p',
          text: 'The list below is pulled live from our catalog — it always matches what the store currently sells. Open any product to see its full description, previews and licence.',
        },
      ],
    },
    {
      id: 'pricing-questions',
      title: 'Questions about pricing',
      blocks: [
        {
          kind: 'p',
          text: 'Unclear about what a price includes, or need a bulk quote for your school, tuition centre or team? Tell us what you need — we reply to every e-mail.',
        },
        {
          kind: 'mail-card',
          subject: 'Pricing question',
          label: 'Email a pricing question',
          body: 'Hello {{businessName}} team,\n\nMy pricing question:\n\nProduct (if any): \n\nThank you,',
        },
      ],
    },
  ],
}
