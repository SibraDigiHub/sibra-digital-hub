// ═══════════════════════════════════════════════════════════
// Refund & Digital Delivery content — instant delivery
// explained, link renewal, and fair refund rules.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const REFUND_PAGE: LegalPageData = {
  id: 'refund-policy',
  title: 'Refund & Digital Delivery',
  tagline:
    'Learn how digital delivery works, how to recover a download link and when you may request a refund.',
  icon: 'refresh',
  sections: [
    {
      id: 'instant-delivery',
      title: 'Digital delivery',
      blocks: [
        {
          kind: 'p',
          text: 'Every product on {{businessName}} is digital. After your payment is confirmed, our system attempts to send your secure download link by e-mail. The link is also displayed on the thank-you page when available. E-mail delivery times may vary.',
        },
        {
          kind: 'list',
          items: [
            'The link works for 48 hours after payment',
            'You can download the file up to 5 times',
            'Files are 300 DPI PDFs / ZIPs sized for A4 and US Letter where printing applies',
            'Check your order confirmation e-mail for the delivery link. If you cannot find it, contact us for help.',
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
          text: 'Download links expire after the stated validity period or when the download limit is reached. If you need access again, e-mail {{email}} with your order ID and the e-mail address used for payment. After verifying your purchase, we can review your request and help with an eligible replacement link. {{responseTime}}',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'clock',
          title: 'Need help recovering a purchase?',
          text: 'Keep your order ID or payment confirmation. Contact support if you cannot access a purchase, and we will check the available order and delivery records.',
        },
      ],
    },
    {
      id: 'refund-rules',
      title: 'Refund rules',
      blocks: [
        {
          kind: 'p',
          text: 'If you have not downloaded the digital product, you may request a refund for an unused order. We will verify the order and assess the request under this policy and applicable law. After a digital product has been downloaded or accessed, a change-of-mind refund may not be available because the content can be copied or retained. This does not limit any rights or remedies available to you under applicable consumer law.',
        },
        {
          kind: 'p',
          text: 'If you experience any of the following issues, contact us as soon as reasonably possible, preferably within 7 days of purchase, so we can investigate. Depending on the issue and applicable law, we may provide a corrected file, replacement delivery or an appropriate refund. This suggested reporting period does not limit any statutory consumer rights:',
        },
        {
          kind: 'list',
          items: [
            'You received an item or file different from the product description or order',
            'The supplied file is corrupt, cannot be opened or is materially unusable',
            'You were charged more than once for the same order',
            'The confirmed purchase was not delivered and the delivery problem could not be resolved',
          ],
        },
        {
          kind: 'callout',
          tone: 'amber',
          icon: 'heart',
          title: 'Something else went wrong?',
          text: 'If your situation is not listed here, contact us with the order details. We will review the issue fairly, subject to applicable law and your statutory rights.',
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
            'If a refund is approved, we initiate it manually through the relevant payment provider, normally using the original payment method where supported',
            'The payment provider or bank controls the final processing time. The time taken for the amount to appear in your account may vary',
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
          text: 'If you purchased through Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books or Gumroad, the platform may handle payment and order support under its applicable terms and refund process. Check your purchase confirmation and contact the relevant platform for assistance. Your rights under applicable law are not waived.',
        },
      ],
    },
    {
      id: 'chargebacks',
      title: 'A gentle note on disputes',
      blocks: [
        {
          kind: 'p',
          text: 'If you have a delivery or billing concern, you are welcome to contact us so we can review it. You may also contact your bank, card issuer or payment provider about a payment dispute. Contacting us first is not a condition for exercising any rights or remedies available to you.',
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
          text: 'E-mail {{email}} with your order ID and a description of the issue. We review general support requests as soon as reasonably practicable. Formal consumer grievances are subject to the statutory timelines stated in our Contact policy.',
        },
      ],
    },
  ],
}
