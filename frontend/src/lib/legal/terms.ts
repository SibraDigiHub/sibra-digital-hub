// ═══════════════════════════════════════════════════════════
// Terms of Service content — plain-language digital licence.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const TERMS_PAGE: LegalPageData = {
  id: 'terms',
  title: 'Terms of Service',
  tagline:
    'The plain-language rules for buying and using digital products from {{businessName}}.',
  icon: 'scroll',
  sections: [
    {
      id: 'acceptance',
      title: 'Acceptance',
      blocks: [
        {
          kind: 'p',
          text: 'By browsing {{businessName}} or buying from it, you agree to these terms. They exist so both sides know where they stand — written to be read, not to trap you.',
        },
        {
          kind: 'p',
          text: 'If you do not agree with something here, please do not purchase — and write to us: if a term feels unfair, we would rather hear it.',
        },
      ],
    },
    {
      id: 'who-can-buy',
      title: 'Who can buy',
      blocks: [
        {
          kind: 'p',
          text: 'You must be 18 or older to purchase. Products designed for children are meant to be chosen and bought by parents, guardians or educators.',
        },
      ],
    },
    {
      id: 'what-we-sell',
      title: 'What we sell',
      blocks: [
        {
          kind: 'p',
          text: 'Digital products only — e-books, printables, templates, prompts, motion assets, scripts, UI kits and resumes. Nothing physical is shipped; every product page states exactly what is inside and in which formats.',
        },
        {
          kind: 'p',
          text: 'Product pages are the description of the deal: contents, file formats, licence type and age suitability. If a product ever differs materially from its page, our Refund Policy has you covered.',
        },
      ],
    },
    {
      id: 'licences',
      title: 'Licences',
      blocks: [
        {
          kind: 'p',
          text: 'Buying a product grants the licence stated on its page — it does not transfer ownership of the files:',
        },
        {
          kind: 'table',
          columns: ['Licence', 'What you may do'],
          rows: [
            [
              'Personal',
              'Use the files with your own children, your classroom or your personal projects',
            ],
            [
              'Commercial (marked on the product)',
              'Use the assets in client work and in end products you sell',
            ],
            [
              'Extended (on request)',
              'Agency and multi-team use — e-mail us and we will set it up',
            ],
          ],
        },
        {
          kind: 'callout',
          tone: 'rose',
          icon: 'scale',
          title: 'What no licence covers',
          text: 'Reselling, redistributing, sharing or bundling the original files — or minor variations of them — free or paid, on any marketplace, file-sharing service or AI training dataset. Your download link is for you; please do not pass it around.',
        },
      ],
    },
    {
      id: 'delivery',
      title: 'Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'After payment your secure download link is e-mailed to you within seconds and also shown on the thank-you page. The link works for 48 hours and up to 5 downloads.',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'clock',
          title: 'Link expired?',
          text: 'No stress — e-mail {{email}} with your order ID and we will send a fresh link. Genuine buyers never lose a purchase.',
        },
      ],
    },
    {
      id: 'protected-videos',
      title: 'Protected videos',
      blocks: [
        {
          kind: 'p',
          text: 'Products delivered as a “protected watch page” give you a personal, time-limited link to watch the video on our site. The video is for your own viewing only — sharing the link, watching with others beyond your plan’s device limit, or re-uploading the video anywhere is not allowed.',
        },
        {
          kind: 'p',
          text: 'Access may be limited to a set number of devices at the same time and to the hours stated at purchase. If a link is shared or used from too many different places, access can be paused or stopped — contact us and we will restore genuine buyers quickly.',
        },
      ],
    },
    {
      id: 'prices',
      title: 'Prices and taxes',
      blocks: [
        {
          kind: 'p',
          text: 'Direct purchases are charged in Indian Rupees (₹) through Razorpay for customers in India. Customers outside India are charged in US dollars (USD) through Razorpay Checkout — the exact USD total is shown at checkout before you pay. Prices in USD shown on product pages elsewhere are for marketplace guidance. Applicable taxes are included where indicated or added at checkout where required.',
        },
        {
          kind: 'p',
          text: 'Prices may change without notice; the price shown at the moment of your purchase is the one that applies. If we ever make an obvious pricing mistake, we will correct it fairly and tell you before taking your money.',
        },
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      blocks: [
        {
          kind: 'list',
          items: [
            'Keep your download link and files to yourself, your family or your licensed team',
            'Do not upload our files to file-sharing sites, marketplaces or AI training sets',
            'Do not use the products for unlawful, harmful or deceptive purposes',
            'Do not attempt to break, scrape or overload the site — honest browsing is all we ask',
          ],
        },
      ],
    },
    {
      id: 'intellectual-property',
      title: 'Intellectual property',
      blocks: [
        {
          kind: 'p',
          text: 'All products, artwork, text and design on this site are owned by {{businessName}} or their licensors and are protected by copyright. Your purchase is a licence to use, not a transfer of ownership.',
        },
      ],
    },
    {
      id: 'liability',
      title: 'Disclaimers and liability',
      blocks: [
        {
          kind: 'p',
          text: 'We work hard to make every file accurate, safe and exactly as described, and we stand behind that. Beyond that, the site and products are provided “as is” to the fullest extent the law allows.',
        },
        {
          kind: 'p',
          text: 'Where the law permits, our total liability for any claim is limited to the amount you paid for the product concerned. Nothing in these terms limits liability that cannot be limited by law — including nothing that would leave you worse off than the law guarantees.',
        },
      ],
    },
    {
      id: 'marketplaces',
      title: 'Marketplace purchases',
      blocks: [
        {
          kind: 'p',
          text: 'When you buy through Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books or Gumroad, your contract is with that platform: their prices, taxes, delivery and refunds apply. This site cannot issue refunds for marketplace purchases — go through the platform where you bought.',
        },
      ],
    },
    {
      id: 'law',
      title: 'Governing law',
      blocks: [
        {
          kind: 'p',
          text: 'These terms are governed by the laws of India.',
        },
        {
          kind: 'list',
          items: ['Exclusive jurisdiction: the courts at {{jurisdiction}}.'],
        },
      ],
    },
    {
      id: 'changes-terms',
      title: 'Changes to these terms',
      blocks: [
        {
          kind: 'p',
          text: 'We may update these terms as the store grows. The “Last updated” date and version at the top of this page always show the current edition, and material changes will be noted on this page.',
        },
      ],
    },
    {
      id: 'contact-terms',
      title: 'Contact',
      blocks: [
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'info',
          title: 'Questions about these terms',
          text: 'E-mail {{email}} — {{responseTime}}',
        },
      ],
    },
  ],
}
