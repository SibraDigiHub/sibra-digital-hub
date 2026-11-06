// ═══════════════════════════════════════════════════════════
// payments-smoke (§12.2) — prints a step-by-step sandbox testing
// checklist and verifies configuration (BOOLEANS ONLY — never
// prints any secret value).
//
//   bun run payments:smoke
// ═══════════════════════════════════════════════════════════

const bool = (v: string | undefined) => Boolean(v)

function line(label: string, ok: boolean): void {
  console.log(`  ${ok ? '✅' : '⚠️ '} ${label}`)
}

const razorpayConfigured = bool(process.env.RAZORPAY_KEY_ID) && bool(process.env.RAZORPAY_KEY_SECRET)
const paypalConfigured = bool(process.env.PAYPAL_CLIENT_ID) && bool(process.env.PAYPAL_CLIENT_SECRET)
const paypalSandbox = process.env.PAYPAL_ENV === 'sandbox'
const razorpayTest = process.env.RAZORPAY_MODE === 'test'
const emailReady = bool(process.env.RESEND_API_KEY)
const cronSecret = bool(process.env.CRON_SECRET)

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SIBRA DIGITAL HUB — PAYMENTS SMOKE CHECK (booleans only)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Configuration
`)
line(`Razorpay credentials present (${process.env.RAZORPAY_MODE ?? 'mode unset'})`, razorpayConfigured)
line(`PayPal credentials present (${process.env.PAYPAL_ENV ?? 'env unset'})`, paypalConfigured)
line(`PayPal webhook id present (PAYPAL_WEBHOOK_ID)`, bool(process.env.PAYPAL_WEBHOOK_ID))
line(`Resend delivery email configured (RESEND_API_KEY)`, emailReady)
line(`CRON_SECRET set (protects /api/cron/*)`, cronSecret)

console.log(`
 Razorpay sandbox test (test mode)
 ─────────────────────────────────
 1. Open the shop → Kids Zone → any ⚡ Instant Download product.
 2. Checkout → confirm country "India" → the quote shows the INR total.
 3. ${razorpayConfigured ? 'Razorpay is configured: pay with a TEST UPI/card (Razorpay test credentials).' : 'No Razorpay keys in this environment: the DEMO UPI QR + "Simulate Payment Success" runs the same pipeline.'}
 4. Confirm the order becomes PAID, the delivery email fires (or is demo-logged), and the webhook event appears once in Admin → System.

 PayPal sandbox test
 ──────────────────────────────
 1. Use a VPN/geo or temporary country override: confirm a NON-India country in checkout.
 2. The quote must switch to "Pay $X.XX securely with PayPal".
 3. ${paypalConfigured ? 'PayPal is configured: pay with the SANDBOX personal account.' : 'No PayPal keys in this environment: the DEMO PayPal button simulates the capture.'}
 4. Confirm the capture, the PAYMENT.CAPTURE.COMPLETED webhook (if configured) and exactly ONE delivery email.

 Webhook URLs (owner setup)
 ──────────────────────────
  Razorpay: https://<backend-host>/api/razorpay/webhook
    events: payment.captured, order.paid, payment.failed, refund.processed
  PayPal:   https://<backend-host>/api/paypal/webhook
    events: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.DECLINED,
            PAYMENT.CAPTURE.PENDING, PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED,
            CUSTOMER.DISPUTE.CREATED, CHECKOUT.ORDER.APPROVED

 Cron (reconcile + email retries, every ~10 min)
 ────────────────────────────────────────────────
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<backend-host>/api/cron/reconcile-payments
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<backend-host>/api/cron/retry-emails
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
