// ═══════════════════════════════════════════════════════════
// Email delivery (T6 §7.2) — ONE interface, two drivers.
//
//   sendEmail({ to, subject, html, text?, template?, orderId? })
//
//   • resend  — POST https://api.resend.com/emails via fetch,
//     Authorization: Bearer RESEND_API_KEY (EMAIL_FROM sender).
//   • console — the dev behaviour: masked recipient + subject
//     are logged, nothing leaves the machine, never the key.
//
// Driver selection: EMAIL_PROVIDER ('resend' | 'console'); when
// unset the resend driver is used iff RESEND_API_KEY exists.
// Missing key → console driver + a one-time warning, never a crash.
//
// Reliability: 10 s timeout per attempt (AbortSignal.timeout), up
// to 3 attempts with 500 ms / 2 s backoff — retried ONLY on network
// errors / 429 / 5xx; other 4xx answers fail immediately. The API
// key and response bodies are never logged.
//
// Every attempt (ok or error) is recorded in the EmailLog table;
// recipients only as a sha256 hash + masked form (privacy).
//
// Templates/subjects/HTML are UNCHANGED (byte-identical) and every
// send carries a plain-text version (derived from the HTML when no
// text is given). No tracking pixels, ever.
// ═══════════════════════════════════════════════════════════
import crypto from 'crypto'
import { logger } from '@/lib/logger'
import { downloadTtlHours, downloadMaxDefault } from '@/config/env'
import { db } from '@/lib/db'

const RESEND_API_URL_DEFAULT = 'https://api.resend.com/emails'
const EMAIL_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 3
/** Backoff between attempts: after attempt 1 → 500 ms, after attempt 2 → 2 s. */
const BACKOFF_MS = [500, 2_000] as const

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
  /** Logical template name for observability (EmailLog.template). */
  template?: string
  /** Related order id, when the email is about one (EmailLog.orderId). */
  orderId?: string
}

export interface EmailResult {
  sent: boolean
  demo: boolean
  error?: string
}

// ── Privacy helpers ─────────────────────────────────────────

/** Mask an email for logs: ab***@domain (never the full address). */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}

/** sha256 of the lower-cased address — EmailLog stores ONLY this. */
function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/**
 * Escape user-controlled text (customer name, product title, alert lines)
 * before HTML interpolation — a name like `<b>x</b>` must never become
 * markup in the delivery email.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Plain-text fallback derived from the HTML (strip tags/entities). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
}

// ── Driver selection ────────────────────────────────────────

export type EmailDriver = 'resend' | 'console'

/** The driver a send will use right now (EMAIL_PROVIDER + key presence). */
export function emailDriver(): EmailDriver {
  const provider = (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase()
  if (provider === 'console') return 'console'
  if (provider === 'resend') return process.env.RESEND_API_KEY ? 'resend' : 'console'
  return process.env.RESEND_API_KEY ? 'resend' : 'console'
}

/** True iff a Resend key is configured (unchanged pre-T6 semantics). */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/** True when sends are demo-logged (console driver) instead of really sent. */
export function emailDemoMode(): boolean {
  return emailDriver() === 'console'
}

let warnedNoKey = false
function warnNoKeyOnce(): void {
  if (warnedNoKey) return
  warnedNoKey = true
  logger.warn('RESEND_API_KEY missing — falling back to the console email driver (emails are logged, not sent)')
}

// ── EmailLog (every attempt, ok or error) ───────────────────

async function recordEmailLog(
  input: Pick<SendEmailInput, 'to' | 'subject' | 'template' | 'orderId'> & {
    provider: EmailDriver
    ok: boolean
    error?: string
    attempt: number
  },
): Promise<void> {
  try {
    await db.emailLog.create({
      data: {
        toHash: input.to ? hashEmail(input.to) : null,
        toMasked: input.to ? maskEmail(input.to) : '***',
        subject: input.subject.slice(0, 300),
        template: input.template ?? null,
        orderId: input.orderId ?? null,
        provider: input.provider,
        ok: input.ok,
        error: input.error ? input.error.slice(0, 500) : null,
        attempt: input.attempt,
      },
    })
  } catch (e) {
    // Observability must never break the send (or the caller).
    logger.warn({ err: e instanceof Error ? e.message : e }, 'email log write failed (non-blocking)')
  }
}

// ── Console driver (dev / unconfigured) ─────────────────────

async function sendViaConsole(input: SendEmailInput): Promise<EmailResult> {
  // Current dev behaviour: masked recipient + subject, never the key.
  logger.info(
    { to: maskEmail(input.to), subject: input.subject, template: input.template ?? null },
    'email console driver (demo — not sent)',
  )
  await recordEmailLog({ ...input, provider: 'console', ok: false, error: 'demo mode — logged only', attempt: 1 })
  return { sent: false, demo: true }
}

// ── Resend driver (fetch, retries, EmailLog) ────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retryable = network error (null status), 429 and any 5xx. Other 4xx never retry. */
function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 429 || status >= 500
}

async function sendViaResend(input: SendEmailInput, apiKey: string): Promise<EmailResult> {
  const from = process.env.EMAIL_FROM || 'Sibra Digital Hub <onboarding@resend.dev>'
  const url = process.env.EMAIL_API_URL || RESEND_API_URL_DEFAULT
  const payload = JSON.stringify({
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    // Always a plain-text version (derived from the HTML when absent).
    text: input.text ?? htmlToText(input.html),
  })

  let lastError = 'email send failed'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status: number | null = null
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      })
      status = res.status
      if (res.ok) {
        await recordEmailLog({ ...input, provider: 'resend', ok: true, attempt })
        return { sent: true, demo: false }
      }
      // The body is deliberately NOT logged — it could echo addresses
      // or key hints; a status is enough to act on.
      lastError = `Resend ${res.status}`
      logger.error({ status: res.status, body: 'resend rejected' }, 'resend error')
    } catch (e) {
      // Network error / timeout — log the error NAME only (never the
      // URL, headers or key).
      const name = e instanceof Error ? e.name : 'NetworkError'
      lastError = `network error (${name})`
      logger.error({ err: name }, 'email send failed')
    }
    await recordEmailLog({ ...input, provider: 'resend', ok: false, error: lastError, attempt })
    if (attempt < MAX_ATTEMPTS && isRetryableStatus(status)) {
      await sleep(BACKOFF_MS[attempt - 1])
      continue
    }
    break
  }
  return { sent: false, demo: false, error: lastError }
}

// ── THE interface ───────────────────────────────────────────

/**
 * Send an email through the configured driver. Never throws — the
 * result reports the outcome. Missing key ⇒ console driver (demo).
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  const to = (input.to ?? '').trim()
  if (!to || !input.subject || !input.html) {
    return { sent: false, demo: false, error: 'sendEmail: to, subject and html are required' }
  }
  const driver = emailDriver()
  if (driver === 'console') {
    // Warn when this is a misconfiguration (resend intended, key missing).
    if (!process.env.RESEND_API_KEY && (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase() === 'resend') {
      warnNoKeyOnce()
    }
    return sendViaConsole(input)
  }
  return sendViaResend(input, process.env.RESEND_API_KEY as string)
}

// ── Templates ── (T6 kept these byte-stable; the ONLY later addition is the
// optional Layer-2 "Rate your download" line, rendered when rateUrl is passed)

interface DeliveryEmailInput {
  to: string
  customerName: string
  productTitle: string
  downloadUrl: string
  amountInr: number
  orderId: string
  // Layer 2 — verified-review invite (the buyer's own rate page). Optional:
  // when absent the email renders exactly as before.
  rateUrl?: string
}

/**
 * T-V Feature C — protected WATCH delivery email. Same visual language
 * as the download email; the CTA opens the on-site watch page. Copy
 * states the access window + device limit truthfully and never claims
 * the video is unbreakable (docs/VIDEO_PROTECTION.md).
 */
interface WatchEmailInput {
  to: string
  customerName: string
  productTitle: string
  watchUrl: string
  ttlHours: number
  maxConcurrent: number
  amountInr: number
  orderId: string
  // Layer 2 — verified-review invite (the buyer's own rate page). Optional:
  // when absent the email renders exactly as before.
  rateUrl?: string
}

export async function sendWatchDeliveryEmail(input: WatchEmailInput): Promise<EmailResult> {
  const customerName = escapeHtml(input.customerName)
  const productTitle = escapeHtml(input.productTitle)
  const html = `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;background:#fffdf6;border-radius:16px;overflow:hidden;border:1px solid #f0e2c0">
    <div style="background:linear-gradient(120deg,#050706,#1a1408);padding:28px;text-align:center">
      <div style="font-size:12px;letter-spacing:3px;color:#e5b842;font-weight:700">SIBRA DIGITAL HUB</div>
      <h1 style="color:#fae8a7;font-size:22px;margin:10px 0 4px">Your video is ready to watch! 🎬</h1>
    </div>
    <div style="padding:28px;color:#3a3123">
      <p>Hi <strong>${customerName}</strong>,</p>
      <p>Thanks for your purchase of <strong>${productTitle}</strong> (₹${Math.round(input.amountInr)}). Your protected watch link is below — access is valid for <strong>${input.ttlHours} hours</strong> from now, on up to <strong>${input.maxConcurrent} device${input.maxConcurrent === 1 ? '' : 's'} at the same time</strong>.</p>
      <p style="text-align:center;margin:26px 0">
        <a href="${input.watchUrl}" style="background:linear-gradient(120deg,#e5b842,#c9932a);color:#050706;font-weight:800;padding:14px 34px;border-radius:999px;text-decoration:none;display:inline-block">▶ Watch Now</a>
      </p>
      <p style="font-size:13px;color:#8a7a5c">Your link is personal — it's for your own viewing, so please don't share it. Sharing it widely can lock the link automatically. If you need help, just reply to this email — we answer within 24 hours.</p>
      ${input.rateUrl ? `<p style="font-size:13px;color:#8a7a5c">⭐ Loved it? <a href="${input.rateUrl}" style="color:#b8860b;font-weight:700">Rate your download</a> — it takes 10 seconds and helps other buyers.</p>` : ''}
      <p style="font-size:12px;color:#b0a488">Order ID: ${input.orderId}</p>
    </div>
    <div style="background:#f6ecd2;padding:14px;text-align:center;font-size:12px;color:#8a7a5c">
      Payments secured by Razorpay · Instant delivery by Sibra Digital Hub
    </div>
  </div>`

  const subject = `🎬 Your video: ${input.productTitle} — Sibra Digital Hub`
  return sendEmail({ to: input.to, subject, html, template: 'delivery-watch', orderId: input.orderId })
}

export async function sendDeliveryEmail(input: DeliveryEmailInput): Promise<EmailResult> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL || ''
  // T5: state the REAL link lifetime/cap (env-driven) instead of hardcoded 72 h / 5.
  const ttlHours = downloadTtlHours()
  const maxDownloads = downloadMaxDefault()
  const customerName = escapeHtml(input.customerName)
  const productTitle = escapeHtml(input.productTitle)

  const html = `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;background:#fffdf6;border-radius:16px;overflow:hidden;border:1px solid #f0e2c0">
    <div style="background:linear-gradient(120deg,#050706,#1a1408);padding:28px;text-align:center">
      <div style="font-size:12px;letter-spacing:3px;color:#e5b842;font-weight:700">SIBRA DIGITAL HUB</div>
      <h1 style="color:#fae8a7;font-size:22px;margin:10px 0 4px">Your download is ready! 🎉</h1>
    </div>
    <div style="padding:28px;color:#3a3123">
      <p>Hi <strong>${customerName}</strong>,</p>
      <p>Thanks for your purchase of <strong>${productTitle}</strong> (₹${Math.round(input.amountInr)}). Your secure download link is below — valid for <strong>${ttlHours} hours</strong> and <strong>${maxDownloads} downloads</strong>.</p>
      <p style="text-align:center;margin:26px 0">
        <a href="${input.downloadUrl}" style="background:linear-gradient(120deg,#e5b842,#c9932a);color:#050706;font-weight:800;padding:14px 34px;border-radius:999px;text-decoration:none;display:inline-block">⬇️ Download Now</a>
      </p>
      <p style="font-size:13px;color:#8a7a5c">Didn't expect this? Questions? Just reply to this email or write to us — we answer within 24 hours.</p>
      ${input.rateUrl ? `<p style="font-size:13px;color:#8a7a5c">⭐ Loved it? <a href="${input.rateUrl}" style="color:#b8860b;font-weight:700">Rate your download</a> — it takes 10 seconds and helps other buyers.</p>` : ''}
      <p style="font-size:12px;color:#b0a488">Order ID: ${input.orderId}</p>
    </div>
    <div style="background:#f6ecd2;padding:14px;text-align:center;font-size:12px;color:#8a7a5c">
      Payments secured by Razorpay · Instant delivery by Sibra Digital Hub
    </div>
  </div>`

  const subject = `⬇️ Your download: ${input.productTitle} — Sibra Digital Hub`
  return sendEmail({ to: input.to, subject, html, template: 'delivery', orderId: input.orderId })
}

// ── T4: security alert emails (admin auth) ──────────────────
// Same demo-mode behaviour: with the console driver the alert is
// logged (masked) and never blocks the action that triggered it.

export async function sendSecurityAlertEmail(to: string, subject: string, bodyLines: string[]): Promise<EmailResult> {
  const html = `
  <div style="font-family:Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;background:#fffdf6;border:1px solid #f0e2c0;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(120deg,#050706,#1a1408);padding:24px;text-align:center">
      <div style="font-size:12px;letter-spacing:3px;color:#e5b842;font-weight:700">SIBRA DIGITAL HUB</div>
      <h1 style="color:#fae8a7;font-size:19px;margin:10px 0 4px">Security alert</h1>
    </div>
    <div style="padding:26px;color:#3a3123">
      <p><strong>${subject}</strong></p>
      ${bodyLines.map((l) => `<p style="margin:6px 0">${l}</p>`).join('')}
      <p style="font-size:13px;color:#8a7a5c;margin-top:18px">If this wasn't you, sign in and change your password immediately, then review Security → Sessions.</p>
    </div>
  </div>`
  const fullSubject = `🔐 Security alert: ${subject} — Sibra Digital Hub`
  return sendEmail({ to, subject: fullSubject, html, template: 'security-alert' })
}
