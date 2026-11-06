// Business rules for site content: FAQs, reviews, public settings.
import { z } from 'zod'
import { badRequest } from '@/lib/api'
import { faqRepo, reviewRepo, settingsRepo } from '@/repositories/content-repo'
import { zoneEnum } from '@/validators/product'

export const SETTING_KEYS = [
  'tickerKidsText',
  'tickerCreatorText',
  'tickerAssetsText',
  'announcementBanner',
  'upiId',
  'upiPayeeName',
  'instantDownloadEnabled',
  'soundEnabled',
  'promoCode',
  'contactEmail',
  'siteTagline',
] as const

export type SettingKey = (typeof SETTING_KEYS)[number]

const DEFAULTS: Record<SettingKey, string> = {
  tickerKidsText: 'Interactive E-Books, Puzzles, ABCD & Fun Coloring Books for Little Minds!',
  tickerCreatorText: 'Premium Canva Templates, High-Converting AI Prompts, Scripts & Responsive Web Designs!',
  tickerAssetsText: 'High-Quality Premium Downloads for Curious Minds & Professionals Aligned!',
  announcementBanner: '',
  upiId: 'sibra@upi',
  upiPayeeName: 'Sibra Digital Hub',
  instantDownloadEnabled: 'true',
  soundEnabled: 'false',
  promoCode: 'SIBRA10',
  contactEmail: 'support@sibradigitalhub.com',
  siteTagline: 'Instant downloads. Pay by card or UPI.',
}

export const faqCreateSchema = z.object({
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
  sortOrder: z.coerce.number().int().default(0),
})

export const reviewCreateSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.string().max(60).default('Parent'),
  avatarEmoji: z.string().max(8).default('🌟'),
  content: z.string().min(1).max(600),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  zone: zoneEnum.default('kids'),
  verified: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
})

/** Only known setting keys are accepted; unknown keys are stripped. */
export const settingsUpdateSchema = z.object(
  Object.fromEntries(SETTING_KEYS.map((k) => [k, z.union([z.string(), z.number(), z.boolean()]).optional()])),
)

export async function buildSettings() {
  const rows = await settingsRepo.all()
  const map: Record<string, string> = { ...DEFAULTS }
  for (const r of rows) map[r.key] = r.value
  return {
    tickerKidsText: map.tickerKidsText,
    tickerCreatorText: map.tickerCreatorText,
    tickerAssetsText: map.tickerAssetsText,
    announcementBanner: map.announcementBanner,
    upiId: map.upiId,
    upiPayeeName: map.upiPayeeName,
    instantDownloadEnabled: map.instantDownloadEnabled === 'true',
    soundEnabled: map.soundEnabled === 'true',
    promoCode: map.promoCode,
    contactEmail: map.contactEmail,
    siteTagline: map.siteTagline,
  }
}

export async function createFaq(input: z.infer<typeof faqCreateSchema>) {
  return faqRepo.create({
    question: input.question.slice(0, 300),
    answer: input.answer.slice(0, 2000),
    sortOrder: input.sortOrder,
  })
}

export async function createReview(input: z.infer<typeof reviewCreateSchema>) {
  return reviewRepo.create({
    name: input.name.slice(0, 60),
    role: input.role.slice(0, 60),
    avatarEmoji: input.avatarEmoji.slice(0, 8),
    content: input.content.slice(0, 600),
    rating: input.rating,
    zone: input.zone,
    verified: input.verified,
    sortOrder: input.sortOrder,
  })
}

export async function updateSettings(body: Record<string, unknown>): Promise<string[]> {
  const changed: string[] = []
  for (const key of SETTING_KEYS) {
    if (body[key] === undefined) continue
    const value = String(body[key])
    await settingsRepo.upsert(key, value)
    changed.push(key)
  }
  return changed
}
