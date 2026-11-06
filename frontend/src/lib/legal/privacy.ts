// ═══════════════════════════════════════════════════════════
// Privacy Policy content — written from the verified data
// inventory (orders, events, e-mail logs, cookies, processors).
// Every claim maps to code; see docs/LEGAL_PAGES.md ledger.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const PRIVACY_PAGE: LegalPageData = {
  id: 'privacy',
  title: 'Privacy Policy',
  tagline:
    'What {{businessName}} collects when you shop for digital books and creator assets — and how little we keep.',
  icon: 'shield',
  showAtGlance: true,
  showRightsCard: true,
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
            'Operated by: {{ownerName}}',
            'Contact and grievances: {{email}}',
            'Postal address: {{address}}',
          ],
        },
      ],
    },
    {
      id: 'what-this-covers',
      title: 'What this policy covers',
      blocks: [
        {
          kind: 'p',
          text: 'This policy covers this website and every purchase you make directly on it.',
        },
        {
          kind: 'p',
          text: 'If you buy through one of our partner marketplaces — Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books or Gumroad — your purchase happens on that platform, and their own privacy policy applies there.',
        },
      ],
    },
    {
      id: 'what-we-collect',
      title: 'What we collect',
      blocks: [
        {
          kind: 'p',
          text: 'Only what is needed to deliver your purchase and keep the store safe. Here is the complete list:',
        },
        {
          kind: 'table',
          columns: ['We collect', 'Why', 'Where it lives', 'How long'],
          rows: [
            [
              'Your name and e-mail',
              'Create your order and deliver your files',
              'Our order database; your name and e-mail are shared with Razorpay to prepare the payment',
              'With your order record, until you ask us to erase them',
            ],
            [
              'Order details — product, amount (₹), payment reference IDs, status, timestamps',
              'Process the payment, prove your purchase, support you',
              'Our order database',
              'As long as required by tax, accounting and legal obligations',
            ],
            [
              'Download token (stored only as a SHA-256 hash), link expiry and download count',
              'Deliver your files securely',
              'Our order database',
              'The link works 48 hours after payment, up to 5 downloads; the hashed record stays with the order',
            ],
            [
              'Anonymous visitor ID (the sdh_vid cookie — a random UUID, no name inside)',
              'Understand site usage and connect your order to your visit so support can help faster',
              'First-party cookie on your device + our database',
              'Cookie: 1 year. Visit events: erased whenever you ask',
            ],
            [
              'Visit events — page and product views, button clicks, searches, device type, coarse country',
              'First-party statistics to improve the site; abuse checks',
              'Our database',
              'Until you ask us to erase them — never used for advertising',
            ],
            [
              'E-mail delivery logs (your address stored only as a SHA-256 hash and a masked form like ab***@…)',
              'Confirm order e-mails were sent and retry if needed',
              'Our database',
              'Kept with the order record',
            ],
            [
              'Abuse-prevention counters (IP addresses only as keyed hashes)',
              'Rate-limiting that stops fraud and spam',
              'Our database',
              'Short windows — minutes to hours',
            ],
          ],
        },
        {
          kind: 'callout',
          tone: 'mint',
          icon: 'heart',
          title: 'What we never collect',
          text: 'Card numbers or CVVs, UPI PINs, bank logins, Aadhaar or other government IDs, your precise location, your contacts, passwords for this site (there are none), or accounts for children. Card data never touches our servers — Razorpay collects it on their secure page.',
        },
      ],
    },
    {
      id: 'how-we-use',
      title: 'How we use your data',
      blocks: [
        {
          kind: 'list',
          items: [
            'Deliver your purchase — e-mail you the secure download link and re-send it when you ask',
            'Verify payments with Razorpay and keep proof of purchase',
            'Support you — renew links, resolve refund or delivery issues',
            'Keep the records we must keep by law',
            'Improve the site using aggregated, first-party statistics',
            'Prevent fraud, spam and abuse',
          ],
        },
        {
          kind: 'p',
          text: 'We do not build advertising profiles, we do not sell or rent personal data, and we do not share it for anyone else’s marketing.',
        },
      ],
    },
    {
      id: 'payments',
      title: 'Payments',
      blocks: [
        {
          kind: 'p',
          text: 'Payments for direct purchases are processed by Razorpay for customers in India (UPI, cards, net banking) and for customers in every other country (USD) via Razorpay Checkout — on the processor’s own secure pages and under its own terms.',
        },
        {
          kind: 'p',
          text: 'We receive a payment status, the amount and reference IDs so we can match the payment to your order. Razorpay may also send you its own payment notification e-mail. We never receive or store your card number, CVV or UPI PIN.',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'info',
          title: 'Marketplaces are not our payment partners',
          text: 'Amazon KDP, Notion Press, Etsy, Payhip, Google Play Books and Gumroad are marketplaces you may choose to buy from. When you buy there, that platform is the seller and handles the payment and your data under its own policy — they do not process payments for purchases made on this website.',
        },
      ],
    },
    {
      id: 'marketplaces',
      title: 'Marketplaces and external links',
      blocks: [
        {
          kind: 'p',
          text: 'Our product pages carry “Buy on …” buttons for partner marketplaces. Clicking one opens that platform in a new tab; from that moment their terms and privacy policy apply.',
        },
        {
          kind: 'p',
          text: 'We record — first-party and anonymous — that a click on a marketplace button happened, so we know which stores are useful to you. We receive nothing from the marketplace about what you do there.',
        },
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies, local storage and similar technologies',
      blocks: [
        {
          kind: 'table',
          columns: ['Name', 'What it does', 'Type', 'How long'],
          rows: [
            [
              'sdh_vid',
              'Anonymous visit ID so statistics and orders make sense',
              'First-party cookie (httpOnly)',
              '1 year',
            ],
            [
              'sdh_zone',
              'Remembers whether you picked the Kids or Creator world',
              'First-party cookie + local storage',
              '30 days',
            ],
            [
              'sdh_sound',
              'Remembers your sound on/off choice',
              'Local storage',
              'Until you clear your browser data',
            ],
            [
              'sdh_entered',
              'Skips the intro animation for the current visit',
              'Session storage',
              'Your current visit',
            ],
            [
              'sdh_admin',
              'Keeps the store owner’s admin session signed in',
              'First-party cookie (httpOnly, admin only)',
              '12 hours maximum',
            ],
          ],
        },
        {
          kind: 'p',
          text: 'That is the whole list. There are no advertising cookies, no third-party cookies and no cross-site trackers anywhere on this site.',
        },
        {
          kind: 'callout',
          tone: 'amber',
          icon: 'kids',
          title: 'Kids pages load nothing from outside our site',
          text: 'Our Kids Zone pages make zero third-party requests — no ad scripts, no profiling, no social widgets, no third-party fonts. Product pictures come from our own site. When you choose to pay, Razorpay’s secure checkout opens as an overlay on this page, served from Razorpay’s own servers under your control.',
        },
      ],
    },
    {
      id: 'analytics',
      title: 'Analytics and your visit trail',
      blocks: [
        {
          kind: 'p',
          text: 'We run our own small, first-party statistics — no Google Analytics, no Meta pixel, no external analytics service.',
        },
        {
          kind: 'p',
          text: 'An event may store: what happened (a product view, a click, a search), which product and zone it belongs to, whether your device is mobile, tablet or desktop, a coarse country from your network, the page path and the anonymous visitor ID. Your raw IP address and browser fingerprint are never stored.',
        },
        {
          kind: 'p',
          text: 'Visit events can be linked to an order through your e-mail and visitor ID — that is how support can trace exactly what happened with a purchase. Events are erased whenever you ask; there is no advertising use, ever.',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'info',
          title: 'About opting out',
          text: 'There is no separate analytics opt-out switch. Because this data is first-party and never sold, the practical opt-out is erasure: e-mail us and we will delete your visit events.',
        },
      ],
    },
    {
      id: 'videos-youtube',
      title: 'Videos & YouTube',
      blocks: [
        {
          kind: 'p',
          text: 'We link to our public YouTube channels — those are ordinary links that open YouTube in a new tab; once you are on YouTube, their own privacy policy applies.',
        },
        {
          kind: 'p',
          text: 'Product videos are NOT loaded automatically. The player shows a poster first, and only after you press Play does the video load from YouTube’s privacy-friendly domain (youtube-nocookie.com). Before that click, YouTube receives nothing from your visit.',
        },
        {
          kind: 'p',
          text: 'For paid “protected watch page” videos we record minimal viewing sessions to enforce the access limits and detect link sharing: a salted one-way hash of your network address (never the raw address), your browser type, and the time of each check-in. Sessions expire with your access link and are deleted on our regular retention schedule.',
        },
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        {
          kind: 'p',
          text: 'This site is for parents, teachers and adult creators. Products designed for children are bought by adults — we do not create accounts for children and children do not check out here.',
        },
        {
          kind: 'p',
          text: 'In line with India’s Digital Personal Data Protection Act, 2023 — where a child means a person under 18 — we do not knowingly collect personal data from children, we run no behavioural tracking or targeted advertising toward children (we serve no targeted advertising to anyone), and we store no child profiles.',
        },
        {
          kind: 'callout',
          tone: 'amber',
          icon: 'kids',
          title: 'Parents: you are in charge',
          text: 'If you believe your child’s information reached us anyway, e-mail us and we will erase it — {{responseTime}}',
        },
      ],
    },
    {
      id: 'emails',
      title: 'E-mails we send',
      blocks: [
        {
          kind: 'list',
          items: [
            'Your order confirmation with the secure download link',
            'A re-sent link when you ask support for one',
            'Security notices — only for the store owner’s admin account',
          ],
        },
        {
          kind: 'p',
          text: 'That is all. There is no marketing e-mail, no newsletter and no “you may also like” spam — no subscription even exists. Our e-mails contain no tracking pixels, so we never know whether you opened one.',
        },
      ],
    },
    {
      id: 'processors',
      title: 'Who we share data with',
      blocks: [
        {
          kind: 'p',
          text: 'Only the processors listed below, only for the purpose shown, and never because someone paid us. We do not sell personal data.',
        },
        {
          kind: 'table',
          columns: ['Processor', 'What it does for us', 'Data involved'],
          rows: [
            [
              'Razorpay (India)',
              'Payment links and payment capture for direct purchases in India',
              'Your name, e-mail and order amount',
            ],
            [
              'Razorpay Checkout (outside-India, when enabled)',
              'Payment capture for direct purchases outside India (USD)',
              'Your name, e-mail and order amount',
            ],
            [
              'Resend',
              'Delivers our transactional e-mails',
              'Your e-mail address',
            ],
            [
              'ImageKit',
              'Serves site images and your purchased files (private files behind short-lived signed URLs)',
              'The files themselves — no personal data',
            ],
            [
              'Our database host (PostgreSQL)',
              'Stores orders, visit events and site settings',
              'The data listed in this policy',
            ],
            [
              'Vercel',
              'Hosts the website and API',
              'Standard platform request logs, under Vercel’s terms',
            ],
            [
              'YouTube (privacy-enhanced mode)',
              'Plays a product video — only on product pages that have one',
              'Viewing data, under YouTube’s terms',
            ],
          ],
        },
        {
          kind: 'p',
          text: 'Some of these processors operate outside India and apply their own contractual and technical safeguards. We keep this list current as the store grows.',
        },
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep data',
      blocks: [
        {
          kind: 'table',
          columns: ['Data', 'How long we keep it'],
          rows: [
            ['Download links', '48 hours after payment, up to 5 downloads — then you can ask us for a fresh link'],
            [
              'Orders and payment records',
              'As long as required by applicable tax, accounting and legal obligations',
            ],
            ['Visit events', 'Until you ask us to erase them — there is no advertising use'],
            ['E-mail delivery logs', 'Kept with the order record'],
            ['Abuse-prevention counters', 'Minutes to hours — just long enough to rate-limit'],
          ],
        },
        {
          kind: 'p',
          text: 'You can always ask us to erase what we hold about you; where the law requires us to keep a record (for taxes, for example), we keep only that and tell you what it is.',
        },
      ],
    },
    {
      id: 'security',
      title: 'How we protect your data',
      blocks: [
        {
          kind: 'list',
          items: [
            'HTTPS everywhere — connections to this site are encrypted',
            'Download tokens are stored only as SHA-256 hashes, never in plain form',
            'Purchased files are private and served behind signed URLs that expire in 10 minutes',
            'E-mail recipients in our logs are stored hashed and masked (ab***@…), never in plain text',
            'Rate limiting on every public form, with IP addresses kept only as keyed hashes',
            'The storefront talks to our API through an internal key that browsers never see',
            'Admin accounts use Argon2id password hashing, two-step verification or passkeys, 12-hour sessions and automatic security alerts',
          ],
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'lock',
          title: 'An honest word about security',
          text: 'No website can promise perfect security — anyone who does is selling you something. What we can promise: we protect what we hold with the measures above, and if anything ever goes wrong we will tell you plainly what happened and what we did about it.',
        },
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      blocks: [
        {
          kind: 'p',
          text: 'In line with the principles of India’s Digital Personal Data Protection Act, 2023, you may:',
        },
        {
          kind: 'list',
          items: [
            'Ask what data we hold about you and get a copy',
            'Ask us to correct anything wrong',
            'Ask us to erase your data',
            'Withdraw consent and ask us to stop a use',
            'Nominate someone to exercise your rights if you cannot',
            'Raise a grievance — and, after using our process, approach the Data Protection Board of India as the Act provides',
          ],
        },
        {
          kind: 'p',
          text: 'To exercise any right, e-mail {{email}} with the subject “Data request”. We may ask one small verification question (such as the e-mail you paid with). {{responseTime}} Where the law requires us to keep a record, we will tell you exactly what and why.',
        },
      ],
    },
    {
      id: 'breaches',
      title: 'Data breaches',
      blocks: [
        {
          kind: 'p',
          text: 'If a breach ever affects your personal data, we will notify you and the authorities as the law requires — in plain words: what happened, what data was involved, what we have done, and what you can do.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        {
          kind: 'p',
          text: 'If we change this policy, we update the “Last updated” date and the version number at the top of this page, and we note significant changes here. The version history starts at v2.0 — the first policy written from a full audit of the code that actually runs this store.',
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        {
          kind: 'p',
          text: 'Questions, requests or grievances — one address reaches a human:',
        },
        {
          kind: 'callout',
          tone: 'gold',
          icon: 'info',
          title: 'Grievance contact',
          text: 'E-mail {{email}} with the subject “Grievance”. Grievance Officer: {{grievanceOfficer}} — {{businessName}}. {{responseTime}}',
        },
      ],
    },
  ],
}
