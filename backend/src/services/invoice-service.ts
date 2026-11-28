// ═══════════════════════════════════════════════════════════
// Invoice service — buyer/admin PDF invoice for PAID orders.
//
// Design notes:
//   • Currency of the invoice = currency the payment was ACTUALLY billed in
//     (Order.currency: INR in India, or merchant-enabled native currency /
//     USD fallback for international checkout). amountMinor in the selected
//     currency's minor units is
//     authoritative; legacy rows without amountMinor fall back to amountInr
//     (INR). Legacy PayPal rows keep their historical gateway reference.
//   • The invoice reference is issued lazily on first download and then
//     immutable (Order.invoiceNumber, unique). Sequential per year, so it is
//     ready for the GST-era series; the seller GSTIN line renders from the
//     INVOICE_GSTIN env (SiteSetting invoiceGstin as legacy fallback) ONLY
//     when the owner configured it — otherwise the line is omitted entirely.
//   • The order's Order ID is printed in the INVOICE DETAILS box so the
//     buyer/admin can match the PDF to a row in the admin Orders table.
//   • PDF is built with pdf-lib (pure JS — runs on Vercel serverless, no
//     headless browser). Standard PDF fonts are WinAnsi-encoded, so every
//     string passes through toWinAnsi() first: the rupee sign becomes "Rs."
//     (the sample invoice rendered it as ■), other exotic glyphs degrade
//     safely instead of throwing.
// ═══════════════════════════════════════════════════════════
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { db } from '@/lib/db'
import { invoiceGstin } from '@/config/env'
import { currencyExponentFactor } from '@/lib/money'

export const INVOICE_PREFIX = 'SDH'

/** Keys read from SiteSetting (camelCase — matches upiId/contactEmail style). */
const INVOICE_SETTING_KEYS = ['invoiceSellerName', 'invoiceSellerBusiness', 'invoiceGstin', 'contactEmail'] as const

interface InvoiceSettings {
  sellerName: string
  sellerBusiness: string
  gstin: string | null
  supportEmail: string | null
}

const SELLER_FALLBACKS: Omit<InvoiceSettings, 'gstin' | 'supportEmail'> = {
  // Owner-confirmed identity (sample invoice). SiteSetting overrides win.
  sellerName: 'Azaz Mohammad',
  sellerBusiness: 'Individual',
}

// ── Text safety (pdf-lib standard fonts are WinAnsi, not Unicode) ──────────

const WINANSI_MAP: Record<string, string> = {
  '₹': 'Rs.',
  '–': '-',
  '—': '-',
  '…': '...',
  '′': "'",
  '‵': "'",
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '\u00A0': ' ',
  '\u200B': '',
}

/** Map a string into WinAnsi-safe text (never throws on exotic glyphs). */
export function toWinAnsi(input: string): string {
  let out = ''
  for (const ch of input) {
    if (WINANSI_MAP[ch] !== undefined) {
      out += WINANSI_MAP[ch]
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\n' || ch === '\t') {
      out += ' '
    } else if (code >= 32 && code <= 255) {
      out += ch
    } else {
      out += '?' // emoji / CJK / symbols outside WinAnsi degrade visibly, not fatally
    }
  }
  return out
}

// ── Money formatting (currency the customer actually paid in) ──────────────

/** Symbols that are safe in WinAnsi standard fonts. INR uses "Rs." (₹ is not encodable). */
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: 'Rs. ',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
}

/** Format the exact billed minor-unit snapshot with the currency's ISO exponent. */
export function formatMoney(minor: number, currency: string): string {
  const factor = currencyExponentFactor(currency)
  if (factor === null) return `${currency} ${minor}`
  const exponent = Math.round(Math.log10(factor))
  const safeMinor = Number.isFinite(minor) ? Math.round(minor) : 0
  const major = safeMinor / factor
  const amount = major.toLocaleString('en-IN', { minimumFractionDigits: exponent, maximumFractionDigits: exponent })
  const symbol = CURRENCY_SYMBOLS[currency]
  return symbol ? `${symbol}${amount}` : `${currency} ${amount}`
}

export function currencyLabel(currency: string): string {
  if (currency === 'INR') return 'INR (Indian Rupee)'
  if (currency === 'USD') return 'USD (US Dollar)'
  if (currency === 'EUR') return 'EUR (Euro)'
  if (currency === 'GBP') return 'GBP (British Pound)'
  return currency
}

// ── Invoice reference numbering (sequential per year, immutable) ───────────

/** Extract the numeric suffix of refs like "SDH-2026-00042" for the given year. */
export function maxInvoiceSequenceForYear(existing: string[], year: number): number {
  const prefix = `${INVOICE_PREFIX}-${year}-`
  let max = 0
  for (const ref of existing) {
    if (!ref.startsWith(prefix)) continue
    const seq = Number.parseInt(ref.slice(prefix.length), 10)
    if (Number.isInteger(seq) && seq > max) max = seq
  }
  return max
}

export function buildInvoiceRef(year: number, seq: number): string {
  return `${INVOICE_PREFIX}-${year}-${String(seq).padStart(5, '0')}`
}

const NUMBER_ISSUE_RETRIES = 3

/**
 * Issue the immutable invoice reference for an order (once). Runs inside a
 * transaction; on a concurrent unique-index clash it recomputes from the
 * latest max and retries.
 */
export async function issueInvoiceNumber(orderId: string): Promise<{ invoiceNumber: string; invoiceIssuedAt: Date }> {
  for (let attempt = 1; attempt <= NUMBER_ISSUE_RETRIES; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId }, select: { invoiceNumber: true, invoiceIssuedAt: true, createdAt: true } })
        if (!order) throw new Error(`Order ${orderId} disappeared while issuing invoice`)
        if (order.invoiceNumber && order.invoiceIssuedAt) return { invoiceNumber: order.invoiceNumber, invoiceIssuedAt: order.invoiceIssuedAt }

        const year = order.createdAt.getUTCFullYear()
        const assigned = await tx.order.findMany({
          where: { invoiceNumber: { not: null, startsWith: `${INVOICE_PREFIX}-${year}-` } },
          select: { invoiceNumber: true },
        })
        const seq = maxInvoiceSequenceForYear(assigned.map((r) => r.invoiceNumber as string), year) + 1
        const invoiceIssuedAt = new Date()
        const updated = await tx.order.update({
          where: { id: orderId },
          data: { invoiceNumber: buildInvoiceRef(year, seq), invoiceIssuedAt },
          select: { invoiceNumber: true, invoiceIssuedAt: true },
        })
        return { invoiceNumber: updated.invoiceNumber as string, invoiceIssuedAt: updated.invoiceIssuedAt as Date }
      })
    } catch (err) {
      // P2002 = unique violation from a concurrent issuer — recompute and retry.
      const code = (err as { code?: string }).code
      if (code !== 'P2002' || attempt === NUMBER_ISSUE_RETRIES) throw err
    }
  }
  throw new Error('unreachable') // loop always returns or throws
}

// ── Invoice data assembly ──────────────────────────────────────────────────

export interface InvoiceData {
  invoiceNumber: string
  issueDate: Date
  seller: { name: string; business: string; gstin: string | null; supportEmail: string | null }
  billTo: { name: string; email: string }
  orderRef: string
  currency: string
  amountMinor: number
  payment: { method: string; reference: string | null }
  product: { title: string }
  orderPlacedAt: Date
}

function paymentMethodLabel(gateway: string): string {
  // Kept short enough to render on ONE line inside the INVOICE DETAILS box
  // ("Razorpay (India — UPI / Card / Netbanking)" wrapped to two lines and
  // pushed the details text out of its fixed-height box — the overlap the
  // owner saw in the printed invoice).
  return gateway === 'paypal' ? 'PayPal (International)' : 'Razorpay (UPI/Card/Netbanking)'
}

function paymentReference(gateway: string, razorpayPaymentId: string | null, paypalCaptureId: string | null, paypalOrderId: string | null): string | null {
  if (gateway === 'paypal') return paypalCaptureId ?? paypalOrderId ?? null
  return razorpayPaymentId
}

/** Authoritative billed amount in minor units (legacy rows fall back to INR amount). */
export function billedAmountMinor(o: { amountMinor: number | null; amountInr: number }): number {
  if (o.amountMinor !== null && Number.isFinite(o.amountMinor)) return o.amountMinor
  return Math.round(o.amountInr * 100)
}

export async function loadInvoiceData(orderId: string): Promise<InvoiceData> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { product: { select: { title: true } } } })
  if (!order) throw new Error(`Order ${orderId} not found`)
  const settings = await db.siteSetting.findMany({ where: { key: { in: [...INVOICE_SETTING_KEYS] } } })
  const value = (key: string): string | null => settings.find((s) => s.key === key)?.value ?? null

  const { invoiceNumber, invoiceIssuedAt } = await issueInvoiceNumber(orderId)
  return {
    invoiceNumber,
    issueDate: invoiceIssuedAt,
    seller: {
      name: value('invoiceSellerName') ?? SELLER_FALLBACKS.sellerName,
      business: value('invoiceSellerBusiness') ?? SELLER_FALLBACKS.sellerBusiness,
      gstin: invoiceGstin() ?? (value('invoiceGstin')?.trim() || null),
      supportEmail: value('contactEmail'),
    },
    billTo: { name: order.customerName, email: order.customerEmail },
    orderRef: order.id,
    currency: order.currency,
    amountMinor: billedAmountMinor(order),
    payment: {
      method: paymentMethodLabel(order.gateway),
      reference: paymentReference(order.gateway, order.razorpayPaymentId, order.paypalCaptureId, order.paypalOrderId),
    },
    product: { title: order.product.title },
    orderPlacedAt: order.createdAt,
  }
}

export function invoiceFileName(invoiceNumber: string): string {
  return `Sibra-Invoice-${toWinAnsi(invoiceNumber).replace(/[^A-Za-z0-9-]/g, '')}.pdf`
}

// ── PDF rendering (pdf-lib, single A4 page, print-friendly) ────────────────

const A4: { width: number; height: number } = { width: 595.28, height: 841.89 }
const MARGIN = 48
const CONTENT_RIGHT = A4.width - MARGIN

const C = {
  navy: rgb(0.09, 0.15, 0.21),
  gold: rgb(0.94, 0.67, 0.16),
  ink: rgb(0.13, 0.16, 0.18),
  gray: rgb(0.42, 0.46, 0.49),
  lightGray: rgb(0.62, 0.66, 0.68),
  boxBg: rgb(0.965, 0.97, 0.975),
  boxBorder: rgb(0.85, 0.87, 0.885),
  rule: rgb(0.82, 0.85, 0.86),
  white: rgb(1, 1, 1),
  green: rgb(0.04, 0.68, 0.47),
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Fit one line into maxWidth: shrink the font stepwise first (keeps the
 * whole string readable), then ellipsize only when even the smallest size
 * still overflows. Guards the fixed-width regions of the invoice (BILL TO
 * box, seller block, purchase-summary description column) against long
 * customer names / emails / product titles that previously overlapped
 * neighbouring text. `text` must already be WinAnsi-safe.
 */
export function fitOneLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  minSize = 7,
): { text: string; size: number } {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size }
  for (let s = size - 0.5; s >= minSize; s -= 0.5) {
    if (font.widthOfTextAtSize(text, s) <= maxWidth) return { text, size: s }
  }
  const suffix = '...'
  let fitted = text
  while (fitted.length > 1 && font.widthOfTextAtSize(fitted + suffix, minSize) > maxWidth) {
    fitted = fitted.slice(0, -1)
  }
  return { text: `${fitted}${suffix}`, size: minSize }
}

function drawRight(page: PDFPage, text: string, font: PDFFont, size: number, xRight: number, y: number, color = C.ink): void {
  page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y, size, font, color })
}

function fmtDate(d: Date): string {
  const win = toWinAnsi(
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  )
  return win
}

export async function buildInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Invoice ${data.invoiceNumber} — Sibra Digital Hub`)
  pdf.setSubject('Digital product purchase invoice')
  pdf.setProducer('Sibra Digital Hub')
  const page = pdf.addPage([A4.width, A4.height])
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)

  // Brand accent bar (Sibra gold)
  page.drawRectangle({ x: 0, y: A4.height - 8, width: A4.width, height: 8, color: C.gold })

  // Header — brand (left) / document title (right)
  page.drawText('SIBRA DIGITAL HUB', { x: MARGIN, y: A4.height - 58, size: 19, font: bold, color: C.navy })
  page.drawText(toWinAnsi('DIGITAL PRODUCTS & DOWNLOADS'), { x: MARGIN, y: A4.height - 72, size: 8.5, font: regular, color: C.gray })
  page.drawText('INVOICE', { x: CONTENT_RIGHT - bold.widthOfTextAtSize('INVOICE', 22), y: A4.height - 58, size: 22, font: bold, color: C.navy })

  // Seller block (left) — values are fitted so a long seller name from
  // SiteSetting can never reach the right-hand reference block.
  const sellerLines: Array<[string, string]> = [
    ['Seller: ', data.seller.name],
    ['Brand / Store: ', 'Sibra Digital Hub'],
    ['Business type: ', data.seller.business],
  ]
  const SELLER_VALUE_MAX = 360 // left block budget: right block starts ≈ x 470
  let y = A4.height - 96
  for (const [label, val] of sellerLines) {
    const labelText = toWinAnsi(label)
    const labelW = bold.widthOfTextAtSize(labelText, 9.5)
    const fit = fitOneLine(toWinAnsi(val), regular, 9.5, Math.max(60, SELLER_VALUE_MAX - labelW))
    page.drawText(labelText, { x: MARGIN, y, size: 9.5, font: bold, color: C.ink })
    page.drawText(fit.text, { x: MARGIN + labelW, y, size: fit.size, font: regular, color: C.ink })
    y -= 13
  }
  // GSTIN renders ONLY when the owner configured one (env INVOICE_GSTIN or
  // the invoiceGstin SiteSetting) — unset means no GSTIN line at all; the
  // owner asked for no "Not applicable" placeholder on the PDF.
  if (data.seller.gstin) {
    const gstinLabelW = bold.widthOfTextAtSize('GSTIN: ', 9.5)
    const gstinFit = fitOneLine(
      toWinAnsi(data.seller.gstin),
      regular,
      9.5,
      Math.max(60, SELLER_VALUE_MAX - gstinLabelW),
    )
    page.drawText('GSTIN: ', { x: MARGIN, y, size: 9.5, font: bold, color: C.ink })
    page.drawText(gstinFit.text, { x: MARGIN + gstinLabelW, y, size: gstinFit.size, font: regular, color: C.ink })
  }

  // Reference block (right)
  const refRows: Array<[string, string]> = [
    ['Invoice reference', data.invoiceNumber],
    ['Issue date', fmtDate(data.issueDate)],
  ]
  y = A4.height - 96
  for (const [label, val] of refRows) {
    drawRight(page, label, bold, 8.5, CONTENT_RIGHT, y)
    drawRight(page, toWinAnsi(val), regular, 10, CONTENT_RIGHT, y - 12)
    y -= 30
  }
  // PAID status chip
  const chipText = 'PAID'
  const chipW = bold.widthOfTextAtSize(chipText, 9) + 16
  const chipX = CONTENT_RIGHT - chipW
  page.drawRectangle({ x: chipX, y: y - 4, width: chipW, height: 16, color: C.green })
  page.drawText(chipText, { x: chipX + 8, y: y + 0.5, size: 9, font: bold, color: C.white })

  page.drawLine({ start: { x: MARGIN, y: A4.height - 176 }, end: { x: CONTENT_RIGHT, y: A4.height - 176 }, thickness: 0.8, color: C.rule })

  // BILL TO / INVOICE DETAILS boxes — boxH fits 5 detail lines (the Order
  // ID row was added so the PDF can be matched to the admin Orders table).
  const boxTop = A4.height - 196
  const boxH = 88
  const boxLeftW = 252
  const boxRightX = MARGIN + boxLeftW + 12
  const boxRightW = CONTENT_RIGHT - boxRightX
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: boxLeftW, height: boxH, color: C.boxBg, borderColor: C.boxBorder, borderWidth: 0.8 })
  page.drawRectangle({ x: boxRightX, y: boxTop - boxH, width: boxRightW, height: boxH, color: C.boxBg, borderColor: C.boxBorder, borderWidth: 0.8 })

  page.drawText('BILL TO', { x: MARGIN + 14, y: boxTop - 16, size: 8.5, font: bold, color: C.gold })
  // Name/email are fitted to the box interior — a long customer name or
  // address-style email previously ran over the box border and into the
  // INVOICE DETAILS box next to it.
  const BILL_TO_MAX = boxLeftW - 28
  const nameFit = fitOneLine(toWinAnsi(data.billTo.name), bold, 11, BILL_TO_MAX, 7.5)
  page.drawText(nameFit.text, { x: MARGIN + 14, y: boxTop - 32, size: nameFit.size, font: bold, color: C.ink })
  const emailFit = fitOneLine(toWinAnsi(data.billTo.email), regular, 9, BILL_TO_MAX, 7)
  page.drawText(emailFit.text, { x: MARGIN + 14, y: boxTop - 46, size: emailFit.size, font: regular, color: C.gray })

  page.drawText('INVOICE DETAILS', { x: boxRightX + 14, y: boxTop - 16, size: 8.5, font: bold, color: C.gold })
  // Order ID fitted to the box interior — a long order id must never touch
  // the box border (same overlap guard as the customer name/email).
  const orderIdFit = fitOneLine(toWinAnsi(data.orderRef), regular, 8.5, boxRightW - 28, 7)
  const details = [
    `Currency: ${currencyLabel(data.currency)}`,
    `Payment method: ${data.payment.method}`,
    `Order ID: ${orderIdFit.text}`,
    `Order placed: ${fmtDate(data.orderPlacedAt)}`,
    'Delivery: Instant download link by email',
  ]
  const detailsBottom = boxTop - boxH + 8 // never draw below the box interior
  let dy = boxTop - 30
  detailLoop: for (const line of details) {
    for (const wrapped of wrapText(toWinAnsi(line), regular, 8.5, boxRightW - 28)) {
      if (dy < detailsBottom) break detailLoop
      page.drawText(wrapped, { x: boxRightX + 14, y: dy, size: 8.5, font: regular, color: C.ink })
      dy -= 11
    }
  }

  // PURCHASE SUMMARY table
  const tableTop = boxTop - boxH - 34
  page.drawText('PURCHASE SUMMARY', { x: MARGIN, y: tableTop, size: 9, font: bold, color: C.gold })
  const headTop = tableTop - 12
  const headH = 22
  page.drawRectangle({ x: MARGIN, y: headTop - headH, width: CONTENT_RIGHT - MARGIN, height: headH, color: C.navy })
  const headY = headTop - headH + 7
  page.drawText('DESCRIPTION', { x: MARGIN + 10, y: headY, size: 8.5, font: bold, color: C.white })
  // White like DESCRIPTION — ink-on-navy made these three labels nearly
  // unreadable (a word-visibility defect in the owner's printed invoice).
  drawRight(page, 'QTY', bold, 8.5, 400, headY, C.white)
  drawRight(page, 'UNIT PRICE', bold, 8.5, 480, headY, C.white)
  drawRight(page, 'AMOUNT', bold, 8.5, CONTENT_RIGHT - 10, headY, C.white)

  const amount = formatMoney(data.amountMinor, data.currency)
  const rowY = headTop - headH - 24
  // Description column ends at the QTY column (right-aligned at x 400) —
  // a long product title previously ran straight through QTY / UNIT PRICE /
  // AMOUNT. Shrink first, ellipsize only when even 7.5pt cannot fit.
  const TITLE_MAX = 400 - (MARGIN + 10) - 8
  const titleFit = fitOneLine(toWinAnsi(data.product.title), bold, 10.5, TITLE_MAX, 7.5)
  page.drawText(titleFit.text, { x: MARGIN + 10, y: rowY, size: titleFit.size, font: bold, color: C.ink })
  page.drawText(toWinAnsi('Digital download — instant delivery'), { x: MARGIN + 10, y: rowY - 13, size: 8.5, font: regular, color: C.gray })
  drawRight(page, '1', regular, 9.5, 400, rowY)
  drawRight(page, toWinAnsi(amount), regular, 9.5, 480, rowY)
  drawRight(page, toWinAnsi(amount), regular, 9.5, CONTENT_RIGHT - 10, rowY)
  page.drawLine({ start: { x: MARGIN, y: rowY - 26 }, end: { x: CONTENT_RIGHT, y: rowY - 26 }, thickness: 0.8, color: C.rule })

  // Subtotal / Total
  const subtotalY = rowY - 46
  page.drawText('Subtotal', { x: MARGIN + 10, y: subtotalY, size: 9.5, font: regular, color: C.gray })
  drawRight(page, toWinAnsi(amount), regular, 9.5, CONTENT_RIGHT - 10, subtotalY)
  const totalY = subtotalY - 30
  page.drawLine({ start: { x: MARGIN, y: totalY + 14 }, end: { x: CONTENT_RIGHT, y: totalY + 14 }, thickness: 0.8, color: C.rule })
  page.drawText('Total', { x: MARGIN + 10, y: totalY, size: 12.5, font: bold, color: C.navy })
  drawRight(page, toWinAnsi(amount), bold, 13, CONTENT_RIGHT - 10, totalY)
  page.drawLine({ start: { x: MARGIN, y: totalY - 10 }, end: { x: CONTENT_RIGHT, y: totalY - 10 }, thickness: 1.6, color: C.gold })

  // DIGITAL DELIVERY note box
  const noteTop = totalY - 44
  const noteH = 62
  page.drawRectangle({ x: MARGIN, y: noteTop - noteH, width: CONTENT_RIGHT - MARGIN, height: noteH, color: C.boxBg, borderColor: C.boxBorder, borderWidth: 0.8 })
  page.drawText('DIGITAL', { x: MARGIN + 14, y: noteTop - 20, size: 8.5, font: bold, color: C.gold })
  page.drawText('DELIVERY', { x: MARGIN + 14, y: noteTop - 32, size: 8.5, font: bold, color: C.gold })
  const noteText =
    'After the payment is successfully verified by the payment provider, the customer receives an email containing a secure, time-limited download link for the purchased digital product.'
  let ny = noteTop - 18
  for (const line of wrapText(toWinAnsi(noteText), regular, 9, CONTENT_RIGHT - MARGIN - 140)) {
    page.drawText(line, { x: MARGIN + 130, y: ny, size: 9, font: regular, color: C.ink })
    ny -= 12
  }

  // Payment reference + notice
  const noticeTop = noteTop - noteH - 26
  if (data.payment.reference) {
    page.drawText(toWinAnsi(`Payment reference: ${data.payment.reference}`), { x: MARGIN, y: noticeTop, size: 8.5, font: regular, color: C.gray })
  }
  page.drawText('IMPORTANT NOTICE', { x: MARGIN, y: noticeTop - 18, size: 8, font: bold, color: C.gray })
  const notice =
    'This is a computer-generated invoice for the purchase of a digital downloadable product. The amount was billed in the currency shown above — INR via Razorpay for customers in India, USD via Razorpay where international checkout is enabled. Tax registration details will be updated here once applicable to the seller.'
  let ty = noticeTop - 31
  for (const line of wrapText(toWinAnsi(notice), regular, 8, CONTENT_RIGHT - MARGIN)) {
    page.drawText(line, { x: MARGIN, y: ty, size: 8, font: regular, color: C.gray })
    ty -= 10.5
  }

  // Footer
  page.drawLine({ start: { x: MARGIN, y: 64 }, end: { x: CONTENT_RIGHT, y: 64 }, thickness: 0.8, color: C.rule })
  page.drawText(toWinAnsi('Thank you for supporting Sibra Digital Hub.'), {
    x: (A4.width - regular.widthOfTextAtSize(toWinAnsi('Thank you for supporting Sibra Digital Hub.'), 8.5)) / 2,
    y: 50,
    size: 8.5,
    font: regular,
    color: C.gray,
  })
  const supportLine = data.seller.supportEmail
    ? `For assistance, contact ${data.seller.supportEmail} or use the contact details published on the official Sibra Digital Hub website.`
    : 'For assistance, please use the contact details published on the official Sibra Digital Hub website.'
  page.drawText(toWinAnsi(supportLine), {
    x: (A4.width - regular.widthOfTextAtSize(toWinAnsi(supportLine), 8)) / 2,
    y: 38,
    size: 8,
    font: regular,
    color: C.lightGray,
  })

  return pdf.save()
}
