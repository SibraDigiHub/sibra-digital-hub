// ═══════════════════════════════════════════════════════════
// Contact page content — support, data requests, grievance.
// Business values render only when the owner sets them.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData } from './types'

export const CONTACT_PAGE: LegalPageData = {
  id: 'contact',
  title: 'Contact Us',
  tagline:
    'Contact {{businessName}} for order support, data requests and formal grievances.',
  icon: 'mail',
  sections: [
    {
      id: 'reach-us',
      title: 'Reach us',
      blocks: [
        {
          kind: 'p',
          text: 'For support, e-mail us with a clear description of the issue. Include your order ID when your question relates to a purchase.',
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
          text: 'To request access to, correction of or erasure of personal data, e-mail us using the button below. Please include the e-mail address used on this site and any relevant order ID. {{responseTime}}',
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
          text: 'If you wish to make a formal consumer complaint, e-mail {{email}} with “Grievance” in the subject line and describe the issue clearly.',
        },
        {
          kind: 'list',
          items: [
            'Name: {{grievanceOfficer}}',
            'Designation: Grievance Officer & Owner, Sibra Digital Hub',
            'Grievance e-mail: {{email}}',
            'Postal address: {{address}}',
            'Phone / WhatsApp: {{supportPhone}}',
          ],
        },
        {
          kind: 'p',
          text: 'Under the Consumer Protection (E-Commerce) Rules, 2020, consumer complaints will be acknowledged within 48 hours of receipt and redressed within one month from the date of receipt.',
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
            '3. Still nothing? E-mail us from the address used for payment. After verifying the purchase, we can check the delivery and help with an eligible replacement link.',
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
          title: 'General support requests',
          text: '{{responseTime}} Formal consumer grievances are subject to the separate statutory timelines stated in the Grievance redressal section.',
        },
      ],
    },
  ],
}
