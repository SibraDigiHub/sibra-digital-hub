// T10 — Category validators: admin-managed, dynamic product categories.
// Slugs are the stable join key to Product.category (immutable after
// create); everything else (label/emoji/blurb/order/visibility) is
// freely editable from the Admin Panel.
import { z } from 'zod'

export const zoneEnum = z.enum(['kids', 'creator'])

/** lowercase-kebab: 'canva-templates', 'ats-resumes', '2d-assets' … */
export const categorySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and single dashes')

export const categoryCreateSchema = z.object({
  zone: zoneEnum,
  label: z.string().trim().min(2, 'at least 2 characters').max(40),
  slug: categorySlugSchema.min(2).max(40).optional(),
  emoji: z.string().trim().max(16).optional(),
  blurb: z.string().trim().max(120).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
})

export const categoryUpdateSchema = z.object({
  label: z.string().trim().min(2, 'at least 2 characters').max(40).optional(),
  emoji: z.string().trim().max(16).optional(),
  blurb: z.string().trim().max(120).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  active: z.coerce.boolean().optional(),
})

export const categoryListQuerySchema = z.object({
  zone: zoneEnum.optional(),
})

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
