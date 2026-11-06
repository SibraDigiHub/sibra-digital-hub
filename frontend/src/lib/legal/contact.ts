// ═══════════════════════════════════════════════════════════
// Contact page content — support, data requests, grievance.
// Business values render only when the owner sets them.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const CONTACT_PAGE: LegalPageData = {
  id: 'contact',
  title: 'Contact Us',
  tagline:
    'One address reaches a human at {{businessName}} — support, data requests and grievances.',
  icon: 'mail',
  sections: [
    {
      id: 'reach-us',
      title: 'Reach us',
      blocks: [
        {
          kind: 'p',
          text: 'The fastest way to a real reply is e-mail. Tell us your order ID when relevant — it lets us pull up everything in seconds.',
        },
        {
          kind: 'mail-card',
          subject: 'Support request',
          label: 'Email support',
          body: 'Hello {{businessName}} team,\n\nMy question:\n\nOrder ID (if any): \nE-mail used for the order: \n\nThank you,',
        },
      ],
    },
    {
      id: 'data-requests',
      title: 'Data requests',
      blocks: [
        {
          kind: 'p',
          text: 'To see, correct or erase the data we hold about you, use the button below — it pre-fills the subject so your request is never missed. {{responseTime}}',
        },
        {
          kind: 'mail-card',
          subject: 'Data request',
          label: 'Email a data request',
          body: 'Hello {{businessName}} team,\n\nI would like to exercise my data rights (access / correction / erasure).\n\nE-mail used on this site: \nOrder ID (if any): \n\nThank you,',
        },
      ],
    },
    {
      id: 'grievance',
      title: 'Grievance redressal',
      blocks: [
        {
          kind: 'p',
          text: 'If something has gone wrong and a normal reply has not fixed it, mark your e-mail “Grievance” — it is read with priority.',
        },
        {
          kind: 'list',
          items: [
            'Grievance Officer: {{grievanceOfficer}}',
            'Grievance e-mail: {{email}}',
            'Postal address: {{address}}',
            'Phone / WhatsApp: {{supportPhone}}',
          ],
        },
      ],
    },
    {
      id: 'missing-email',
      title: 'Missing your delivery e-mail?',
      blocks: [
        {
          kind: 'list',
          items: [
            '1. Check spam and promotions folders for “{{businessName}}”.',
            '2. Search your inbox for your order ID.',
            '3. Still nothing? E-mail us from the address you paid with and we will re-send the download link.',
          ],
        },
      ],
    },
    {
      id: 'bulk',
      title: 'Bulk & school licences',
      blocks: [
        {
          kind: 'p',
          text: 'Teachers, schools, tuition centres and studios get bundle pricing on 10+ copies. Tell us what you need and how many learners — we will put a quote together.',
        },
      ],
    },
    {
      id: 'response-time',
      title: 'Response time',
      blocks: [
        {
          kind: 'callout',
          tone: 'mint',
          icon: 'clock',
          title: 'When we reply',
          text: '{{responseTime}} — 7 days a week, real humans, plain words.',
        },
      ],
    },
  ],
}
