import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site-url'

// robots.txt — generated (not static) so the sitemap reference is an
// absolute URL built from the site-URL helper (no hard-coded domain).
// Public pages are crawlable; private/transactional paths are not.
// AI and search crawlers are NOT blocked.
//
// GEO (generative-engine optimisation): the major LLM/answer-engine
// crawlers ALSO get explicit named rules with the same allow/disallow as
// the wildcard, so assistant engines (ChatGPT search, Perplexity, Claude,
// Gemini, Meta AI…) see written permission instead of having to interpret
// the wildcard — some of them only honour explicit grants. Google-Extended
// only gates Gemini grounding; it does NOT affect Google Search ranking.
const PRIVATE_PATHS = ['/admin', '/api', '/thank-you', '/download', '/watch']

const AI_CRAWLERS = [
  'GPTBot', // OpenAI model training
  'OAI-SearchBot', // ChatGPT search index (SearchGPT citations)
  'ChatGPT-User', // ChatGPT live browsing
  'PerplexityBot', // Perplexity search index
  'Perplexity-User', // Perplexity user-initiated fetch
  'ClaudeBot', // Anthropic training
  'Claude-User', // Claude user-initiated fetch
  'Claude-SearchBot', // Claude search index
  'Google-Extended', // Gemini grounding (search ranking unaffected)
  'meta-externalagent', // Meta AI
  'Amazonbot', // Alexa
  'Applebot-Extended', // Apple Intelligence
  'YouBot', // You.com
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
