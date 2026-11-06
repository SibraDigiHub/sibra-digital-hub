// ═══════════════════════════════════════════════════════════
// Invoice logic (pure rules, no DB):
//   • money renders in the currency the customer actually paid in
//     (INR → "Rs. " — the ₹ glyph is not WinAnsi-encodable in standard
//     PDF fonts, the sample invoice rendered it as ■)
//   • every string that reaches the PDF is WinAnsi-safe
//   • invoice references are sequential per year and never regress
//   • the generated PDF is a valid single-page PDF document
// Run:  DATABASE_URL=postgresql://postgres@127.0.0.1:5432/sibra bun test tests/routes/invoice-logic.test.ts
// (inline DATABASE_URL = project convention — the sandbox parent dir carries a
// decoy .env whose value would otherwise win over backend/.env)
// ═══════════════════════════════════════════════════════════
import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'

import {
  billedAmountMinor,
  buildInvoicePdf,
  buildInvoiceRef,
  currencyLabel,
  formatMoney,
  invoiceFileName,
  loadInvoiceData,
  maxInvoiceSequenceForYear,
  toWinAnsi,
  type InvoiceData,
} from '@/services/invoice-service'

describe('formatMoney — currency the customer paid in', () => {
  test('INR uses "Rs." prefix (WinAnsi-safe), paise from minor units', () => {
    expect(formatMoney(19900, 'INR')).toBe('Rs. 199.00')
    expect(formatMoney(19999, 'INR')).toBe('Rs. 199.99')
  })

  test('USD uses $ — a USA customer sees dollars', () => {
    expect(formatMoney(1900, 'USD')).toBe('$19.00')
    expect(formatMoney(129949, 'USD')).toBe('$1,299.49')
  })

  test('EUR/GBP use their symbols; unknown currency falls back to the ISO code', () => {
    expect(formatMoney(500, 'EUR')).toBe('€5.00')
    expect(formatMoney(500, 'GBP')).toBe('£5.00')
    expect(formatMoney(500, 'AUD')).toBe('AUD 5.00')
  })

  test('rounds half units and survives non-finite input defensively', () => {
    expect(formatMoney(19950, 'INR')).toBe('Rs. 199.50')
    expect(formatMoney(Number.NaN, 'INR')).toBe('Rs. 0.00')
  })
})

describe('toWinAnsi — PDF text safety', () => {
  test('maps the rupee sign and typographic punctuation', () => {
    expect(toWinAnsi('₹199')).toBe('Rs.199')
    expect(toWinAnsi('Kids’ Bundle — Vol. 2')).toBe("Kids' Bundle - Vol. 2")
  })

  test('degrades emoji/CJK to ? instead of throwing', () => {
    expect(toWinAnsi('Fun 🎨 Pack')).toBe('Fun ? Pack')
    expect(toWinAnsi('色测试')).toBe('???')
  })

  test('keeps plain ASCII and latin-1 intact', () => {
    expect(toWinAnsi('Printable Worksheets (Ages 4-8)')).toBe('Printable Worksheets (Ages 4-8)')
    expect(toWinAnsi('Café')).toBe('Café')
  })
})

describe('invoice reference numbering', () => {
  test('maxInvoiceSequenceForYear picks the highest sequence of that year only', () => {
    const existing = ['SDH-2026-00001', 'SDH-2026-00042', 'SDH-2025-00099', 'SDH-2026-garbage']
    expect(maxInvoiceSequenceForYear(existing, 2026)).toBe(42)
    expect(maxInvoiceSequenceForYear(existing, 2025)).toBe(99)
  })

  test('empty year starts the series at 1, zero-padded to 5 digits', () => {
    expect(buildInvoiceRef(2026, maxInvoiceSequenceForYear([], 2026) + 1)).toBe('SDH-2026-00001')
    expect(buildInvoiceRef(2026, 42)).toBe('SDH-2026-00042')
  })
})

describe('billedAmountMinor', () => {
  test('amountMinor wins when present', () => {
    expect(billedAmountMinor({ amountMinor: 19900, amountInr: 1 })).toBe(19900)
  })

  test('legacy rows without amountMinor fall back to the INR amount', () => {
    expect(billedAmountMinor({ amountMinor: null, amountInr: 199.5 })).toBe(19950)
  })
})

describe('labels and filenames', () => {
  test('currency label is human readable', () => {
    expect(currencyLabel('INR')).toBe('INR (Indian Rupee)')
    expect(currencyLabel('USD')).toBe('USD (US Dollar)')
  })

  test('invoice file name is ASCII-safe and unique per reference', () => {
    expect(invoiceFileName('SDH-2026-00001')).toBe('Sibra-Invoice-SDH-2026-00001.pdf')
  })
})

describe('buildInvoicePdf', () => {
  const data: InvoiceData = {
    invoiceNumber: 'SDH-2026-00001',
    issueDate: new Date('2026-11-02T10:00:00.000Z'),
    seller: { name: 'Azaz Mohammad', business: 'Individual', gstin: null, supportEmail: null },
    billTo: { name: 'Sample Customer 🎨', email: 'sample@example.com' },
    orderRef: 'order_1',
    currency: 'USD',
    amountMinor: 1900,
    payment: { method: 'PayPal (International)', reference: 'PAYID-123' },
    product: { title: 'Premium Creator UI Kit — ₹ Edition' },
    orderPlacedAt: new Date('2026-11-02T09:00:00.000Z'),
  }

  test('produces a valid single-page PDF (magic bytes parse via pdf-lib)', async () => {
    const bytes = await buildInvoicePdf(data)
    expect(bytes.byteLength).toBeGreaterThan(1000)
    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(1)
    expect(loaded.getTitle()).toBe('Invoice SDH-2026-00001 — Sibra Digital Hub')
  })

  test('loadInvoiceData throws for a missing order (no silent fallback)', async () => {
    await expect(loadInvoiceData('no-such-order-id')).rejects.toThrow('not found')
  })
})
