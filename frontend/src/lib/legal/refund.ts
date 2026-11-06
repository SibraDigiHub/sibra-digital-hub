// ═══════════════════════════════════════════════════════════
// Refund & Digital Delivery content — instant delivery
// explained, link renewal, and fair refund rules.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const REFUND_PAGE: LegalPageData = {
  id: 'refund-policy',
  title: 'Refund & Digital Delivery',
  tagline:
    'Digital goods are delivered instantly — here is exactly how delivery works and when refunds apply.',
  icon: 'refresh',
  sections: [
    {
      id: 'instant-delivery',
      title: 'Instant digital delivery',
      blocks: [
        {
          kind: 'p',
          text: 'Every product on {{businessName}} is digital. The moment your payment is confirmed, your secure download link is e-mailed to you — usually within seconds — and also shown on the thank-you page.',
        },
        {
          kind: 'list',
          items: [
            'The link works for 48 hours after payment',
            'You can download the file up to 5 times',
            'Files are 300 DPI PDFs / ZIPs sized for A4 and US Letter where printing applies',
            'A backup copy of the link always sits in your e-mail',
          ],
        },
      ],
    },
    {
      id: 'renewal',
      title: 'Need a fresh link?',
      blocks: [
        {
          kind: 'p',
          text: 'Links expire by design — your purchase does not. If your link has expired or hit its download limit, e-mail {{email}} with your order ID and the e-mail you paid with. We will send a renewed link to genuine buyers, free, {{responseTime}}',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'clock',
          title: 'Never lose a purchase',
          text: 'Every payment is verifiable from your order ID. Even months later, one e-mail brings your files back.',
        },
      ],
    },
    {
      id: 'refund-rules',
      title: 'Refund rules',
      blocks: [
        {
          kind: 'p',
          text: 'Digital files can be copied the moment they arrive, so purchases are generally non-refundable once the file has been downloaded. Before download, an unused order can be refunded on request.',
        },
        {
          kind: 'p',
          text: 'Whatever the situation, these four things are always covered — request within 7 days of purchase and we will fix it or refund you in full, your choice:',
        },
        {
          kind: 'list',
          items: [
            'You received the wrong item or the wrong file',
            'The file is corrupt, will not open, or is unusable',
            'You were charged twice for the same product',
            'Delivery failed — the link never worked and we could not fix it',
          ],
        },
        {
          kind: 'callout',
          tone: 'amber',
          icon: 'heart',
          title: 'Something else went wrong?',
          text: 'Policies cannot list every situation. Write to us first — we would rather make it right than argue about a rule.',
        },
      ],
    },
    {
      id: 'how-to-request',
      title: 'How to request a refund',
      blocks: [
        {
          kind: 'list',
          items: [
            'E-mail {{email}} with your order ID and a short description of the issue — a screenshot helps a lot',
            'We may ask for the e-mail you paid with so we can verify the purchase quickly',
            'Approved refunds go back to your original payment method through Razorpay',
            'Banks typically take 5–7 business days to reflect the money on your statement',
          ],
        },
      ],
    },
    {
      id: 'marketplace-refunds',
      title: 'Marketplace purchases',
      blocks: [
        {
          kind: 'p',
          text: 'Bought through Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books or Gumroad? That platform processed your payment, so refunds are handled under that platform’s own policy — contact them directly with your order details.',
        },
      ],
    },
    {
      id: 'chargebacks',
      title: 'A gentle note on disputes',
      blocks: [
        {
          kind: 'p',
          text: 'Please talk to us before opening a payment dispute — we can usually solve the problem the same day, and a chargeback freezes the order while everyone waits. Honest conversation, faster fix.',
        },
      ],
    },
    {
      id: 'contact-refund',
      title: 'Contact',
      blocks: [
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'info',
          title: 'Refund & delivery help',
          text: 'E-mail {{email}} with your order ID — {{responseTime}}',
        },
      ],
    },
  ],
}
