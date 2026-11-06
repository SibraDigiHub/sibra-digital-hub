import { z } from 'zod'

/**
 * Layer 2 — verified-purchase product reviews. The submitter proves the
 * purchase with their order's download token (never stored in plain text);
 * everything else is a normal moderated review payload.
 */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** GET/POST /api/reviews/order — the order's download token is the proof. */
export const reviewTokenSchema = z.object({
  token: z.string().trim().min(20, 'This review link is not valid').max(200),
})

export const reviewSubmitSchema = reviewTokenSchema.extend({
  rating: z.coerce.number().int().min(1, 'Pick a star rating').max(5),
  text: z.string().trim().max(1000, 'Keep your review under 1000 characters').default(''),
  name: z
    .string()
    .trim()
    .min(2, 'Please enter your name (at least 2 characters)')
    .max(40)
    .optional(),
})

/** GET /api/reviews/product — approved reviews + summary for one product. */
export const publicReviewsQuerySchema = z.object({
  slug: z.string().trim().min(1).max(200),
})

/** GET /api/admin/reviews/product — moderation queue. */
export const adminReviewListQuerySchema = z.object({
  status: z.enum(['all', ...REVIEW_STATUSES]).default('all'),
})

/** PATCH /api/admin/reviews/product/[id] — moderation decision. */
export const reviewModerationSchema = z.object({
  status: z.enum(['approved', 'rejected']),
})

export type ReviewSubmitInput = z.infer<typeof reviewSubmitSchema>
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>
export type ReviewModerationInput = z.infer<typeof reviewModerationSchema>
