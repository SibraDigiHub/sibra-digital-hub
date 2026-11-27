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
              'Use the files at home, in your classroom or at family events for personal use. You may not resell, redistribute or share the files themselves.',
            ],
            [
              'Commercial (marked on the product)',
              'Use the assets in client work, monetised channels and end products you sell, up to 500 end products. Attribution is appreciated but not required. Teams larger than 5 seats need an extended licence.',
            ],
            [
              'Extended',
              'Unlimited commercial projects, agency use and white-label resale of derivative work. Original source files may not be resold as-is or repackaged as a competing template.',
            ],
          ],
        },
        {
          kind: 'callout',
          tone: 'rose',
          icon: 'scale',
          title: 'What no licence covers',
          text: 'Unless expressly permitted by an extended licence, you may not resell, redistribute, share or bundle the original source files as-is, or repackage them as competing templates. You may not upload the source files to file-sharing services or AI training datasets. An extended licence may permit white-label resale of derivative end products, but never resale of the original source files as-is.',
        },
      ],
    },
    {
      id: 'delivery',
      title: 'Delivery',
      blocks: [
        {
          kind: 'p',
          text: 'After payment confirmation, we attempt to send your secure download link by e-mail. The link may also be displayed on the thank-you page when available. Unless a different limit is stated for your purchase, the default link validity is 48 hours and the default limit is 5 downloads per order. These limits may be changed by the applicable product or delivery settings.',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'clock',
          title: 'Link expired?',
          text: 'If your link expires or you reach the download limit, e-mail {{email}} with your order ID or payment confirmation. After verifying your purchase, we can review your request and may issue a replacement link. A replacement is not automatic or guaranteed.',
        },
      ],
    },
    {
      id: 'protected-videos',
      title: 'Protected videos',
      blocks: [
        {
          kind: 'p',
          text: 'Products delivered through a “protected watch page” provide a personal, time-limited link to watch the video on our site. The access duration and maximum number of simultaneous viewing devices are specified for the product or at purchase. The link is for the purchaser’s permitted personal viewing and must not be shared, transferred or used to re-upload or redistribute the video.',
        },
        {
          kind: 'p',
          text: 'Our system may monitor viewing sessions and apply access limits to help detect link sharing. If activity exceeds the applicable concurrent-device limit or triggers our security checks, access may be temporarily or permanently locked pending review. Contact {{email}} with your order details if you believe access was restricted incorrectly. Any review or restoration is subject to verification and is not guaranteed.',
        },
      ],
    },
    {
      id: 'prices',
      title: 'Prices and taxes',
      blocks: [
        {
          kind: 'p',
          text: 'Direct purchases are charged in Indian Rupees (₹) through Razorpay for customers in India. Customers outside India may be charged in a merchant-enabled local currency or in US dollars (USD) when local currency is unavailable. The exact currency and total are shown at checkout before you pay. Prices in USD shown on product pages elsewhere are the USD base price used to calculate eligible local-currency prices. Applicable taxes are included where indicated or added at checkout where required.',
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
          text: "When you follow a link from this site to an external store or marketplace, you complete the purchase under the terms shown by that store. Before paying, review the listing and checkout for the seller's identity, price, taxes, product format, licence, delivery and refund terms. Responsibility for fulfilment, customer support and refunds depends on the seller identified for that transaction, the store's terms and applicable law. Contact the relevant seller or marketplace for transaction-specific assistance. Nothing in these terms excludes any consumer rights or legal responsibilities that cannot lawfully be excluded.",
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
