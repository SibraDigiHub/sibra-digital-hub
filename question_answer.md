# Sibra Digital Hub — Questions & Answers

> Owner ke sawal aur unke detailed jawab. Har nayi entry is file mein add hoti hai.

---

## Q1: RAZORPAY_WEBHOOK_SECRET kya hai? Ye mere project mein use hoga ya nahi? Iska kya use aur fayda hai? Ye Razorpay se kaise milega?

**Date:** 16 Nov 2026

### Short Answer (TL;DR)

- **Use hoga ya nahi?** — **Haan, 100% use hoga.** Aapke project ka backend production mein bina iske **boot hi nahi karega** jab Razorpay keys set hongi (ye security guard code mein likha hai). Ye **mandatory production env var** hai.
- **Kya hai?** — Ek **aapka khud banaya hua password** jo aap Razorpay dashboard mein webhook banate waqt khud type karte ho. Isse Razorpay ke server aapke backend ko bhejte hue har payment message par ek **digital signature** lagate hain, aur aapka backend us signature ko check karke confirm karta hai ki message **sach mein Razorpay se aaya hai, kisi hacker se nahi**.
- **Fayda?** — (1) **Fraud se bachav** — koi fake "payment ho gaya" message bhej kar free downloads nahi le sakta. (2) **Order kabhi miss nahi hota** — customer ne payment karke browser bandh kar diya to bhi webhook se order deliver ho jata hai. (3) **Refund pe download turant band** hota hai.
- **Kaise milega?** — Ye Razorpay **apne aap nahi deta**. Aapko Razorpay Dashboard → Account Settings → Webhooks → Add New Webhook mein **khud ek strong secret type karna** hai, aur wahi value backend ke env var `RAZORPAY_WEBHOOK_SECRET` mein daalni hai.

---

### 1. Ye cheez hai kya? (Concept — bina jargon ke)

Jab customer aapke store se payment karta hai, to paise Razorpay ke paas jaate hain. Ab Razorpay ko aapke backend ko **batana padta hai** ki "payment capture ho gaya" — is notification ko **webhook** kehte hain (server-to-server automatic message, koi insaan nahi bhejta).

Problem ye hai ki webhook endpoint (`/api/razorpay/webhook`) ek **public URL** hai — duniya ka koi bhi banda us URL par fake message bhej sakta hai jaise *"payment.captured — is order ko deliver kar do"*. Agar aapka backend bina check ke maan jaye, to koi bhi **bina paise diye products download** kar lega.

Isi liye **webhook secret** ka system hai:

1. Aap ek secret string banate ho, jaise: `sdh-whk-9f3Kq2Lm7XpR4vTn8WcYb6Zd5Ge3Hs1A`
2. Ye secret aap **2 jagah** rakhte ho:
   - Razorpay dashboard (webhook settings mein)
   - Aapke backend ka env var `RAZORPAY_WEBHOOK_SECRET`
3. Ab jab bhi Razorpay webhook bhejta hai, wo **secret se message ka HMAC-SHA256 signature** bana kar `X-Razorpay-Signature` header mein bhejta hai.
4. Aapka backend wahi calculation khud karta hai (same secret + same message = same signature) aur dono ko **constant-time** compare karta hai.
5. Signature match hua → message genuine hai → order process karo.
6. Signature match nahi hua ya secret missing hai → **400 Invalid Signature, order process hi nahi hota** — bina dekhe-vichare reject.

Simple words mein: **ye ek "tum bhej rahe ho ya main hi bhej raha hoon?" ka poora proof hai.** Sirf Razorpay aur aapke paas ye secret hai, isliye sirf Razorpay ka bheja message valid ho sakta hai.

---

### 2. Aapke project mein use hoga ya nahi? (Code se proof)

**Haan, use hoga — aur production mein ye optional nahi, zaroori hai.** Maine aapke actual code se ye sab verify kiya hai:

| Kahan | Kya hota hai | File (proof) |
|---|---|---|
| Env template | `RAZORPAY_WEBHOOK_SECRET=""` placeholder already documented hai | `backend/.env.example` line 83 |
| Config schema | Variable optional-defined hai dev ke liye | `backend/src/config/env.ts` line 53 |
| **Production guard** | Agar `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` set hain aur webhook secret **missing** hai → backend **start hi nahi hoga** (fail-closed). Error: *"RAZORPAY_WEBHOOK_SECRET is required in production when Razorpay keys are set — webhook deliveries drive fulfillment"* | `backend/src/config/env.ts` lines 371–381 |
| Signature verify | `verifyWebhookSignature()` — HMAC-SHA256 of **raw body** vs `X-Razorpay-Signature` header, `crypto.timingSafeEqual` se compare (timing-attack safe). Secret ya signature missing → `false` | `backend/src/lib/razorpay.ts` lines 250–256 |
| Webhook endpoint | `POST /api/razorpay/webhook` — poori payment fulfillment iske through chalti hai | `backend/src/app/api/razorpay/webhook/route.ts` |
| Tests | Ye behaviour automated tests mein bhi locked hai (fail-closed test pass hota hai) | `backend/tests/payments/unit.test.ts`, `backend/tests/security/boot-guard.test.ts` |

**Ek aur important baat** — aapke project mein payment verify karne ke **2 raaste** hain:

| Raaste | Kab chalta hai | Kaunsa secret use hota hai |
|---|---|---|
| `POST /api/razorpay/verify` | Jab customer checkout complete karke browser wapas aata hai (Standard Checkout signature check) | `RAZORPAY_KEY_SECRET` (ye alag cheez hai — dekho section 6) |
| `POST /api/razorpay/webhook` | Razorpay ke server khud events push karte hain | **`RAZORPAY_WEBHOOK_SECRET`** |

**Webhook kyun zaroori hai jab verify route pehle se hai?** Kyunki customer ke paas browser zaroori nahi hota: agar wo payment karke turant tab bandh kar de, internet beech mein cut ho jaye, ya checkout success page load na ho — to client-side verify **kabhi nahi chalega**. Us case mein sirf webhook hi order deliver kara sakta hai. Code ke comment mein khud likha hai: *"without the secret every delivery is rejected and orders only reconcile via cron"* — matlab bina secret ke real payments sirf cron reconciliation se manually pakde jayenge. Isliye production guard boot rok deta hai.

---

### 3. Aapke project mein ye EXACTLY kya-kya karta hai?

`backend/src/app/api/razorpay/webhook/route.ts` — ye endpoint ye 4 events handle karta hai:

| Event | Kya hota hai aapke project mein |
|---|---|
| `payment.captured` / `order.paid` | **Order fulfil hota hai**: amount + currency DB order se match karaya jata hai (paise ka exact match — INR order par INR hi chalega), `fulfillOrder()` chalta hai → download token banta hai → customer ko email jati hai |
| `payment.failed` | Sirf log hota hai (`PaymentAttempt` FAILED), order **pending rehta hai** — customer dobara try kar sakta hai |
| `refund.processed` | **Download access revoke** hota hai (jo bhi us order ka deliver hua tha uska access band), admin ko alert jata hai. Agar refund order se match nahi hua to payment_id se match karke bhi revoke kiya jata hai — ek bhi refund miss nahi hona chahiye |

Aur har event par ye security layers lagi hain (sab already built hai, aapko kuch nahi karna):

1. **Signature pehle, business baad** — bad signature → audit log (`webhook.rejected`) + 400, order process **shuru hi nahi hota**.
2. **Idempotency** — Razorpay kabhi-kabhi same event dobara bhejta hai (retry). Har event ka id `WebhookEvent` table mein unique record hota hai; duplicate aaye to "ok, duplicate" jawab milta hai aur **order dobara deliver nahi hota** (double email/double access ka chance zero).
3. **Amount tampering guard** — webhook mein aaya paid amount ya currency DB order se alag hai → 409 + **aapko (admin ko) turant alert**. Ye price-arbitrage attack signal hota hai.
4. **Order matching sirf notes se** — order sirf us reference se match hota hai jo aapne Razorpay order banate waqt khud lagaya tha (`notes.orderRef`). Koi "isi email ka latest pending order pakad lo" wala guesswork nahi.
5. **Body size cap** — 1MB se bada webhook body reject (memory-DoS se bachav).
6. **International card guard** — agar `RAZORPAY_BLOCK_INTERNATIONAL_CARDS` on hai aur INR order par foreign card aaya → fulfil refuse + admin alert.

**Matlab:** ye secret sirf "password" nahi hai — ye poori payment security chain ki neev hai jo aapke code mein pehle se built hai. Aapko bas dashboard aur env var mein same value daalni hai.

---

### 4. Iska fayda kya hai? (Owner ke hisaab se)

1. **Fraud-proof fulfillment** — bina valid signature ke koi bhi "deliver kar do" request kaam nahi karegi. Hacker, script-kiddie, ya jealous competitor fake webhook maar ke free products nahi le sakta.
2. **Sales kabhi miss nahi hoti** — customer ne paise diye aur page bandh kar diya? Webhook aayega, order fulfill hoga, email jayegi. Bina webhook ke wo customer support par phone karta ki "paise gaye, product nahi mila" — aur wo paisa refund karna padta.
3. **Refund = instant access revoke** — aap Razorpay dashboard se refund karte ho, webhook aata hai, customer ka download access turant band. Manually kuch nahi karna padta.
4. **Double-delivery se bachav** — duplicate webhooks automatically dedupe hote hain. Ek hi order ke 2 emails ya 2 download tokens kabhi nahi banenge.
5. **Aapko hamesha pata rahega** — koi bhi tampering ya mismatch hui to aapko admin alert email jati hai (sirf chupchaap reject nahi hota).
6. **Payment-gateway best practice** — Razorpay ki official recommendation bhi ye hai ki har production merchant webhook signature verify kare. Aapka project already industry-standard hai.

---

### 5. Ye Razorpay se kaise milega? (Step-by-step)

**Sabse important baat:** Razorpay aapko ye secret **mail se ya kisi box mein generate karke nahi deta**. Ye **aap khud banate ho** — dashboard mein webhook banate waqt ek "Secret" field hota hai jisme aap khud ek strong random string type karte ho. Phir wahi string aap apne backend env mein copy karte ho.

#### Step 1: Secret generate karo (dashboard mein daalne se pehle)

Aap khud ek strong random string banao. Terminal wale ke liye:

```bash
openssl rand -hex 20
```

Isse 40 characters ka random hex string milega (jaise `a3f9c2e81b7d4f6e0c5a9b8d7e2f1a3c4b5d6e7f`). Dashboard ~30 characters tak allow karta hai, to pehle 30 characters le lena, ya thoda chhota generate karo:

```bash
openssl rand -hex 15   # 30 characters
```

**Rule:** koi birthday/name/phone wali guessable string nahi. Random hi rakhna.

#### Step 2: Razorpay Dashboard mein webhook banao (TEST mode pehle)

1. **dashboard.razorpay.com** par login karo.
2. Top-right/Account section mein **mode toggle** hota hai (Test / Live). Pehle **Test mode** select karo.
3. Left sidebar → **Account Settings** → **Webhooks** tab.
4. **"+ Add New Webhook"** button dabao.
5. Fields bharo:
   - **Webhook URL:** aapke **backend ka production URL** + `/api/razorpay/webhook`
     - Example: `https://<aapka-backend-domain>/api/razorpay/webhook`
     - HTTPS **zaroori** hai (Vercel khud https deta hai). HTTP nahi chalega.
     - Ye URL **backend** ka hai (api service), frontend store ka nahi.
   - **Secret:** Step 1 wali string yahan paste karo.
   - **Active Events** — in 4 ko select karo (aapke code sirf inko handle karta hai, baaki ignore hote hain):
     - `payment.captured`
     - `order.paid`
     - `payment.failed`
     - `refund.processed`
6. **Save** karo.

> Test mode aur Live mode ke webhooks **alag-alag** hote hain. Test dashboard mein bana webhook sirf test payments ke liye hai. Live ke liye Step 4 mein Live mode select karke same process dobara karna hoga (Live dashboard mein).

#### Step 3: Wahi secret backend env mein daalo

Ab wahi secret string aapke backend ke environment variable mein jayegi:

- **Variable name:** `RAZORPAY_WEBHOOK_SECRET`
- **Value:** dashboard mein jo secret daala, **exactly wahi** (ek space ya quote bhi extra nahi)
- **Kahan:** Vercel → aapka **backend** project → Settings → Environment Variables (aur `.env` mein sirf local dev ke liye — jo git mein nahi jata, aapke backup zip se `.env` already excluded hai, ye safe hai)

**Triple-check:** dashboard aur env var ki value **byte-to-byte same** honi chahiye. 90% webhook problems ("Invalid signature") isi mismatch se aati hain — copy-paste mein trailing space, ya purana secret dashboard mein aur naya env mein.

#### Step 4: Test karo

- Razorpay dashboard ke webhook settings mein **"Send test webhook"** button hota hai — use dabao aur dekho ki aapke backend ke logs mein webhook aaya.
- Test mode mein ek dummy payment karke dekho: order fulfill hua + email aayi.
- Backend logs mein `webhook.rejected` dikhe to signature mismatch hai → Step 3 ka triple-check karo.

#### Production (Live) checklist — jab real paisa aana shuru ho

- [ ] Live mode dashboard mein webhook banao (same URL, **naya/alag secret bhi rakh sakte ho** — alag rakhna better hai)
- [ ] Live secret backend ke **production env vars** mein daalo (Vercel)
- [ ] `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` bhi **live** (`rzp_live_...`) wale hon, test wale nahi
- [ ] Ek real (chhoti amount) live payment karke end-to-end verify karo: order paid → email → download chala
- [ ] Backend boot guard khud confirm karega: production mein keys set hain par webhook secret nahi → server start nahi hoga (ye aapko bachata hai, bug nahi)

---

### 6. Confusion door karo: WEBHOOK_SECRET vs KEY_SECRET (ye alag cheezein hain)

| | `RAZORPAY_KEY_SECRET` | `RAZORPAY_WEBHOOK_SECRET` |
|---|---|---|
| Ye kya hai | Aapke API account ka private half (`rzp_live_xxx` key id ke saath ka pair) | Aapka khud banaya webhook password |
| Kahan se mila | Razorpay **generate karke deta hai** (Dashboard → Settings → API Keys → Generate Key) | **Aap khud banate ho** webhook banate waqt |
| Kya karta hai | (1) Razorpay API calls authorize karta hai (order create), (2) checkout signature verify karta hai (`order_id\|payment_id` ka HMAC) | Webhook messages ki authenticity verify karta hai (`raw body` ka HMAC vs `X-Razorpay-Signature`) |
| Kahan use hota hai project mein | `backend/src/lib/razorpay.ts` — `verifyCheckoutSignature()` + API `basicAuth()` | `backend/src/lib/razorpay.ts` — `verifyWebhookSignature()` (webhook route only) |
| Change/rotate karna | Razorpay ke dashboard se regenerate | Aap dashboard mein edit karke env var bhi update karo — **dono ek saath**, warna saari deliveries 400 hongi |

**Dono alag values hain — ek dusre mein paste mat karna.** KEY_SECRET ko webhook secret ki tarah use karna, ya webhook secret ko KEY_SECRET jagah lagana, dono galat hai.

---

### 7. Do's aur Don'ts

**Do:**
- Secret ko sirf Razorpay dashboard + env var (ya password manager) mein rakho
- Random string use karo (`openssl rand -hex 15`)
- Test aur Live ke liye alag secrets rakho
- Secret rotate karne ke baad dashboard + env **ek saath** update karo

**Don't:**
- Secret ko git commit mein, chat mein, screenshot mein, ya kisi document (isi file ke baaki sections mein bhi) mat likho
- KEY_SECRET aur WEBHOOK_SECRET interchange mat karo
- Dashboard mein secret change karke env update karna mat bhoolo — us waqt ke saare webhooks reject honge (jo orders webhook se miss hue wo cron reconciliation se pakde jayenge, par email instant nahi jayegi)
- Webhook URL HTTP par mat set karna — https hi rakhna

---

### 8. Agar ye set nahi hua to kya hoga? (Exact behaviour)

| Situation | Kya hoga |
|---|---|
| Sandbox / local dev (keys set hain) | Backend chalega (secret optional in dev), par **saari webhook deliveries reject** hongi (400). Orders sirf client-side verify ya cron reconcile se pakde jayenge |
| **Production, Razorpay keys set, secret missing** | **Backend boot hi nahi karega** — fail-closed guard (`env.ts` boot-guard). Ye jaan-bujh ke rakha hai: webhook ke bina live sales miss hoti, isliye galti se launch nahi ho sakta |
| Production, Razorpay keys hi nahi | Webhook secret ki zaroorat nahi (payments hi off hain), boot ho jayega |
| Secret dashboard aur env mein alag-alag | Har webhook 400 `Invalid signature` → orders fulfill nahi honge → admin audit log mein `webhook.rejected` entries. Fix: dono jagah same value |

---

### Ek line mein jawab

> **RAZORPAY_WEBHOOK_SECRET aapka khud banaya hua webhook password hai — Razorpay dashboard mein webhook banate waqt aap khud set karte ho aur wahi value backend env var mein daalni hoti hai. Aapke project mein ye production mein zaroori hai (iske bina backend start hi nahi hoga jab Razorpay keys set hongi), aur ye fraud se bachav, missed sales se bachav, instant refund-revoke aur duplicate-delivery protection deta hai — poori logic aapke code mein pehle se built hai, aapko sirf dashboard + env var mein same secret daalna hai.**

---

## Q2: Production-ready payment ke liye kaunse variables kahan se milenge, kaunse steps follow karne hain, true/false kya bharna hai, kya dhyaan rakhna hai, aur payment kaise test karna hai? (Beginner step-by-step guide)

**Date:** 16 Nov 2026

> **Note:** `.env.example` jo `docs/RAZORPAY_SETUP.md` / `docs/DEPLOYMENT.md` reference karta hai — wo docs files repo mein abhi exist nahi karti. **Is Q2 aur dedicated `ENV_SETUP.md` file dono hi aapka complete owner setup guide hain.** Sab kuch aapke actual code (`backend/.env.example`, `backend/src/config/env.ts`, `backend/vercel.json`, cron routes) se verify kiya gaya hai. Detailed env tables ke liye `ENV_SETUP.md` dekho.

### Short Answer

Aapko 4 groups ke variables bharne hain — **database** (Neon se 2 URLs), **secrets** (5 aap khud `openssl` se generate karoge), **Razorpay** (dashboard se live keys + aapka khud ka webhook secret), aur **email/URLs** (Resend + domain). Order: Razorpay KYC → Neon → secrets → backend deploy → frontend deploy → admin create → webhook → cron scheduler → health check → test mode testing → ₹1 live test + refund. Poora env-table aur step-by-step `ENV_SETUP.md` mein hai; yahan quick summary di gayi hai.

### 1. System architecture (2 Vercel projects)

```
Customer → FRONTEND (Vercel #1) → /api proxy (x-internal-key) → BACKEND (Vercel #2) → PostgreSQL (Neon) + Razorpay + Resend + R2
Razorpay server ──(webhook, signature verified)──▶ BACKEND → fulfill → email → download
Cron scheduler (10-15 min, Bearer CRON_SECRET) ──▶ BACKEND → reconcile missed payments
```

### 2. Variables — value kahan se milega (quick)

| Group | Variables | Kahan se |
|---|---|---|
| Database | `DATABASE_URL` (pooled), `DIRECT_URL` (direct) | **neon.tech** |
| Secrets (5) | `ENCRYPTION_KEY`, `SESSION_PEPPER`, `INTERNAL_API_KEY`, `CRON_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Aap khud `openssl rand` se |
| Razorpay | `RAZORPAY_KEY_ID` (rzp_live_), `RAZORPAY_KEY_SECRET`, `RAZORPAY_MODE="live"` | Razorpay Dashboard → API Keys (KYC ke baad) |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), `EMAIL_PROVIDER="resend"` | resend.com |
| Admin | `ADMIN_REQUIRE_2FA="true"`, `ADMIN_WEBAUTHN_RP_ID`, `ADMIN_WEBAUTHN_ORIGIN` | Aap khud |
| Recommended | `PAYMENT_ALERT_EMAIL`, `RAZORPAY_BLOCK_INTERNATIONAL_CARDS="true"` | Aap khud |
| Storage | `IMAGEKIT_*`, `R2_*` | imagekit.io / Cloudflare R2 |

**Frontend mein sirf 3 REQUIRED:** `BACKEND_URL`, `INTERNAL_API_KEY` (backend wali SAME), `NEXT_PUBLIC_SITE_URL`. `NEXT_PUBLIC_RAZORPAY_KEY_ID` ki zaroorat NAHI.

### 3. Boolean recommended values

`RAZORPAY_MODE="live"` • `RAZORPAY_BLOCK_INTERNATIONAL_CARDS="true"` • `REVOKE_ON_REFUND="true"` • `RAZORPAY_ENABLED="true"` • `ALLOW_REPEAT_PURCHASE="false"` • `INTERNATIONAL_CHECKOUT_ENABLED="false"` (Razorpay International activation ke baad hi `true`).

### 4. DANGER — ye 6 production mein kabhi set mat karna

`DEMO_MODE`, `ALLOW_TEST_PAYMENTS_IN_PRODUCTION`, `RAZORPAY_API_BASE`, `EMAIL_API_URL` (boot fail ya simulated payments), `LEGACY_ORDERS_ENABLED`, `ALLOW_LOCAL_BACKEND_URL` (khaali chhodo).

### 5. Setup steps (order)

0. Razorpay KYC complete
1. Neon DB banao (pooled + direct)
2. 5 secrets generate karo
3. Backend Vercel deploy (Root=`backend`, saare env vars)
4. Frontend Vercel deploy (Root=`frontend`, 3 vars)
5. First admin: `DATABASE_URL=... DIRECT_URL=... bun run admin:create` → 2FA → recovery codes save
6. Razorpay webhook configure (backend URL + `/api/razorpay/webhook` + secret + 4 events)
7. External cron scheduler (10-15 min, 2 endpoints, Bearer CRON_SECRET)
8. Health check: `GET /api` → `demoMode:false, testPaymentsAllowed:false`

### 6. Payment testing (3 phases)

- **Phase 1 Test Mode:** Card `4111 1111 1111 1111` (success) / `4000 0000 0000 0002` (failure), UPI `success@razorpay` / `failure@razorpay`. Verify: payment captured → webhook 200 → email → download → admin paid → refund se access revoke.
- **Phase 2 Live ₹1 method:** sasta product ₹1 → apne UPI se pay → poori checklist verify → dashboard se refund → price restore.
- **Phase 3 Reliability:** webhook disable karke payment → cron reconcile fulfill kare → resend email aazmao → alerts inbox check.

### 7. Top precautions (14 poore `ENV_SETUP.md` mein)

1. `INTERNAL_API_KEY` dono projects mein EXACT same (sabse common mistake)
2. `RAZORPAY_MODE` aur key prefix match (`live` ⇔ `rzp_live_`) warna boot fail
3. Webhook secret dashboard + env dono jagah same, ek saath rotate
4. Production mein NAYE secrets — sandbox ki values copy mat karo
5. Resend domain verify zaroori — warna customer ko email nahi jayegi

### Ek line mein jawab

> **Aapko 4 groups ke variables bharne hain — database (Neon se 2 URLs), secrets (5 aap khud `openssl` se generate karoge), Razorpay (dashboard se live keys + aapka khud ka webhook secret), aur email/URLs (Resend + domain). Boolean table ke hisaab se `RAZORPAY_MODE=live`, `RAZORPAY_BLOCK_INTERNATIONAL_CARDS=true`, `PAYMENT_ALERT_EMAIL` set karo, 6 danger variables kabhi set mat karo. Poora env-table aur step-by-step `ENV_SETUP.md` mein hai.**

---
