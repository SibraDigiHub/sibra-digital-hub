// Prisma access for site content aggregates: FAQs, reviews, settings.
import { db } from '@/lib/db'

export const faqRepo = {
  listAll() {
    return db.faqItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] })
  },
  create(data: { question: string; answer: string; sortOrder: number }) {
    return db.faqItem.create({ data })
  },
  remove(id: string) {
    return db.faqItem.delete({ where: { id } })
  },
}

export const reviewRepo = {
  listAll() {
    return db.review.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }] })
  },
  create(data: {
    name: string
    role: string
    avatarEmoji: string
    content: string
    rating: number
    zone: string
    verified: boolean
    sortOrder: number
  }) {
    return db.review.create({ data })
  },
  remove(id: string) {
    return db.review.delete({ where: { id } })
  },
}

export const settingsRepo = {
  all() {
    return db.siteSetting.findMany()
  },
  upsert(key: string, value: string) {
    return db.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  },
}
