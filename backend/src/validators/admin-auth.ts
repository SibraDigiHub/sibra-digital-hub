// T4 admin auth validators — Zod strictObject everywhere.
import { z } from 'zod'
import { passwordSchema } from '@/lib/auth/password'

const emailField = z.string().trim().toLowerCase().email('Invalid email').max(254)
const codeField = z.string().trim().min(6).max(10).regex(/^\d+$/, 'Code must be digits')

export const loginSchema = z.strictObject({
  email: emailField,
  password: z.string().min(1, 'Password is required').max(128),
})

export const login2faSchema = z
  .strictObject({
    code: codeField.optional(),
    recoveryCode: z.string().trim().min(8).max(32).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide either a TOTP code or a recovery code',
  })

/** WebAuthn payloads are complex browser JSON — validated structurally, verified by the library. */
export const passkeyResponseSchema = z.record(z.unknown())
export const passkeyLoginOptionsSchema = z.strictObject({ email: emailField })
export const passkeyLoginVerifySchema = z.strictObject({
  email: emailField,
  response: passkeyResponseSchema,
})
export const passkeyRegisterVerifySchema = z.strictObject({
  response: passkeyResponseSchema,
  name: z.string().trim().min(1).max(60).optional(),
})
export const passkeyDeleteSchema = z.strictObject({ password: z.string().min(1).max(128) })

export const totpEnrollSchema = z.strictObject({})
export const totpConfirmSchema = z.strictObject({ code: codeField })
export const totpDisableSchema = z.strictObject({ password: z.string().min(1).max(128) })

export const recoveryRegenSchema = z
  .strictObject({ password: z.string().max(128).optional() })
  .refine((v) => typeof v.password === 'string', { message: 'Password is required' })

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12, 'Password must be at least 12 characters').max(128),
  })

export const forgotPasswordSchema = z.strictObject({ email: emailField })

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(16).max(128),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
  secondFactor: z
    .strictObject({
      totp: codeField.optional(),
      recoveryCode: z.string().trim().min(8).max(32).optional(),
    })
    .refine((v) => Boolean(v.totp) !== Boolean(v.recoveryCode), {
      message: 'Provide either a TOTP code or a recovery code',
    }),
})

export const sessionsDeleteSchema = z.object({ otherOnly: z.boolean().optional() }).default({})

/** Factory so password policy can check against the admin's email (CLI + reset reuse it). */
export { passwordSchema }
