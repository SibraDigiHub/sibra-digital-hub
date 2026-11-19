# Sibra Digital Hub — Complete ENV Setup Guide

> Poora env-variable reference: **LOCAL testing** (aapke laptop par) aur **VERCEL production** (live server) — dono ke liye.
> Har variable ka naam, kya value rakhni hai, true/false kya, aur kahan se milega — sab table mein.
> `.env` files kabhi git mein commit nahi hoti (`.gitignore` mein blocked). Hamesha `.env.example` se copy karke `.env` banao.

---

## Table of Contents

1. [Secrets generate karne ke commands (ek baar chala lo)](#secrets-generate)
2. [MASTER TABLE — Backend variables (Local vs Production)](#backend-master)
3. [MASTER TABLE — Frontend variables (Local vs Production)](#frontend-master)
4. [Step-by-step: LOCAL testing setup](#local-steps)
5. [Step-by-step: VERCEL production deploy](#prod-steps)
6. [Quick verification checklist](#verify)

---

<a id="secrets-generate"></a>
## 1. Secrets generate karne ke commands (ek baar chala lo)

Terminal (Mac/Linux/Git Bash/WSL) mein ye 5 commands chalao. Har command ki output ek line hogi — usse copy karke env mein paste karo.

```bash
openssl rand -base64 32     # → ENCRYPTION_KEY        (local + prod DONO ke liye alag-alag banao)
openssl rand -base64 32     # → SESSION_PEPPER        (local + prod alag)
openssl rand -hex 24        # → INTERNAL_API_KEY      (ek hi value backend+frontend mein SAME — local ke liye ek, prod ke liye naya)
openssl rand -hex 24        # → CRON_SECRET            (prod ke liye zaroori; local mein khaali bhi chalta hai)
openssl rand -hex 15        # → RAZORPAY_WEBHOOK_SECRET (dashboard webhook + env mein SAME)
```

**Rule:** Production ke liye **NAYE** secrets banao — local/dev wale values production mein **copy mat karo**.

---

<a id="backend-master"></a>
## 2. MASTER TABLE — Backend variables (`backend/.env` local / Vercel backend project)

> **Local:** `backend/.env` file banao (`.env.example` se copy) aur values bharo.
> **Production:** Vercel → aapka **backend project** → Settings → Environment Variables mein same values daalo.

### Group A — Database

| Variable | LOCAL value (testing) | PRODUCTION value (Vercel) | Kahan se milega / Note |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require` | Same (pooled Neon string) | **neon.tech** → Project → Connection string (hostname mein `-pooler` ho) |
| `DIRECT_URL` | `postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require` | Same (direct Neon string, bina `-pooler`) | Neon dashboard se **direct** wali string (migrations ke liye) |

### Group B — Security secrets (aap khud generate karoge)

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `ENCRYPTION_KEY` | `openssl rand -base64 32` ka output | **NAYA** `openssl rand -base64 32` output | 32 bytes base64 — TOTP secrets encrypt karta hai |
| `SESSION_PEPPER` | `openssl rand -base64 32` ka output | **NAYA** output | ≥32 bytes base64 — IP/UA hashes ka salt |
| `INTERNAL_API_KEY` | `openssl rand -hex 24` (frontend mein SAME) | **NAYA** `openssl rand -hex 24` (frontend mein SAME) | ≥16 chars; backend + frontend EXACT match zaroori |
| `INTERNAL_API_KEY_PREVIOUS` | (khaali chhodo) | (khaali chhodo) | Sirf rotation ke waqt use |
| `CRON_SECRET` | (khaali chhodo — dev mein cron bina token chalta hai) | `openssl rand -hex 24` ka output | **REQUIRED production** — cron endpoints bina token refuse karte hain |
| `RAZORPAY_WEBHOOK_SECRET` | `openssl rand -hex 15` (local webhook test via ngrok ke liye; warna khaali) | `openssl rand -hex 15` (dashboard webhook mein SAME) | Razorpay dashboard + env mein byte-to-byte same |

### Group C — Razorpay (payment gateway)

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_test_XXXXXXXXXX` (Test dashboard se) | `rzp_live_XXXXXXXXXX` (Live dashboard se, KYC ke baad) | Razorpay Dashboard → Settings → API Keys → Generate Test/Live Key |
| `RAZORPAY_KEY_SECRET` | Test secret (ek baar dikhega, copy karo) | Live secret (ek baar dikhega, copy karo) | Same jagah — Generate dabane par sirf ek baar |
| `RAZORPAY_MODE` | `"test"` | `"live"` | **MUST match key prefix**: `test`⇔`rzp_test_`, `live`⇔`rzp_live_` — mismatch pe prod boot fail |
| `RAZORPAY_WEBHOOK_SECRET` | (Group B wali value, agar local webhook test karna hai) | (Group B wali value) | Q1 dekho — poora detail |
| `RAZORPAY_API_BASE` | (khaali chhodo) | (khaali chhodo — **KABHI set mat karna prod mein**) | Test-only override — prod mein boot fail |

### Group D — URLs

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `PUBLIC_WEB_URL` | `http://localhost:3000` | `https://aapka-domain.com` | Frontend ka URL; prod mein **https zaroori** (http pe boot fail) |

### Group E — Email

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `EMAIL_PROVIDER` | `""` (khaali — auto console driver) ya `"console"` | `"resend"` | Prod mein `"resend"` explicit — warna boot fail |
| `RESEND_API_KEY` | `""` (khaali — console driver chalega, emails console mein log honge) | `re_XXXXXXXX` (resend.com → API Keys) | Prod mein **REQUIRED** — warna boot fail |
| `EMAIL_FROM` | `""` (console driver ke saath zaroori nahi) | `Sibra Digital Hub <orders@aapka-domain.com>` | Resend mein **domain verified** hona chahiye |
| `EMAIL_API_URL` | (khaali chhodo) | (khaali chhodo — **KABHI set mat karna**) | Test-only — prod mein boot fail |

### Group F — Admin login / WebAuthn

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `ADMIN_REQUIRE_2FA` | `"false"` (dev convenience — 2FA skip kar sakte ho locally) | `"true"` (**MANDATORY** — `false` pe prod boot fail) | Prod mein 2FA mandatory |
| `ADMIN_PASSKEYS_ENABLED` | `"true"` | `"true"` | Default |
| `ADMIN_WEBAUTHN_RP_ID` | `localhost` | `aapka-domain.com` (bare host, bina https://) | Frontend ka host |
| `ADMIN_WEBAUTHN_ORIGIN` | `http://localhost:3000` | `https://aapka-domain.com` | Full origin |
| `ADMIN_WEBAUTHN_RP_NAME` | `"Sibra Digital Hub"` | `"Sibra Digital Hub"` | Default |
| `ADMIN_RESET_TTL_MINUTES` | `"30"` | `"30"` | Default |

### Group G — Alerts & safety (recommended)

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `PAYMENT_ALERT_EMAIL` | `""` (khaali — dev mein first admin pe fallback) | `aapka-email@gmail.com` (monitored inbox) | **Recommended prod** — fraud/mismatch alerts yahan aayenge |
| `RAZORPAY_BLOCK_INTERNATIONAL_CARDS` | `"true"` (test behavior ke liye) | `"true"` (**recommended**) | Foreign card INR order par fulfill refuse + alert |

### Group H — Storage (ImageKit + Cloudflare R2)

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `IMAGEKIT_PRIVATE_KEY` | `""` (khaali — upload route 501 fallback dega, dev OK) | imagekit.io → Developer → API keys → Private Key | Prod mein real chahiye (admin uploads ke liye) |
| `NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY` | `""` | Same page → Public Key | Backend env mein daalo (frontend mein NAHI) |
| `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` | `""` | `https://ik.imagekit.io/<aapka-id>` | Backend env mein |
| `R2_ACCOUNT_ID` | `""` | Cloudflare dashboard → R2 → account id | Prod mein real (paid deliverables ke liye) |
| `R2_ACCESS_KEY_ID` | `""` | R2 → Manage API Tokens → Create → Read & Write | Prod mein real |
| `R2_SECRET_ACCESS_KEY` | `""` | Same token creation pe milega | Prod mein real |
| `R2_BUCKET_NAME` | `""` | Aapka R2 bucket naam (PRIVATE bucket) | Prod mein real |
| `R2_S3_ENDPOINT` | `""` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | Prod mein real |
| `R2_REGION` | `"auto"` | `"auto"` | Fixed value |

### Group I — Boolean toggles (behavior)

| Variable | LOCAL value | PRODUCTION value | Agar ulta kiya to |
|---|---|---|---|
| `INTERNATIONAL_CHECKOUT_ENABLED` | `"false"` | `"false"` (jab tak Razorpay International activation na ho) | `true` bina activation: checkout dikhega par payment decline |
| `RAZORPAY_FOREIGN_CURRENCIES` | `"USD"` | `"USD"` | Merchant account mein enabled currencies ki allowlist (jaise `USD,EUR,GBP`); USD fallback rakhein. Foreign prices `priceUsd` se daily Frankfurter reference rate par convert hoti hain. |
| `RAZORPAY_BLOCKED_COUNTRIES` | `""` | `""` | Country codes comma-se (jaise `PK,IR`) — un countries se checkout block |
| `ALLOW_REPEAT_PURCHASE` | `"false"` | `"false"` | `true` = customer same product dobara khareed sakta hai |
| `REVOKE_ON_REFUND` | `"true"` | `"true"` | `false` = refund ke baad bhi download access chalu — **kabhi mat karna** |
| `RAZORPAY_ENABLED` | `"true"` | `"true"` | `false` = poora gateway off (emergency kill switch) |
| `DOWNLOAD_TTL_HOURS` | `"48"` | `"48"` | Download link validity ghanto mein |
| `DOWNLOAD_MAX_DEFAULT` | `"5"` | `"5"` | Max downloads per order |

**Currency conversion note:** Frankfurter reference rates are fetched server-side and cached; no FX API key is required. These are daily reference/mid-market rates, not card-network quotes. If a country's native currency is not enabled for this Razorpay merchant, or its FX rate is unavailable, checkout/display falls back to USD (provided USD is enabled). `RAZORPAY_FOREIGN_CURRENCIES` must contain only codes activated for this specific Razorpay account, and should normally include `USD`.

### Group J — Danger variables (PROD mein KABHI set mat karna)

| Variable | LOCAL (dev OK) | PRODUCTION | Kyun |
|---|---|---|---|
| `DEMO_MODE` | `""` (khaali) | `""` (**kabhi `true` nahi**) | `true` = payments simulate, real paisa nahi |
| `ALLOW_TEST_PAYMENTS_IN_PRODUCTION` | `""` | `""` (**kabhi `true` nahi**) | `true` = test payments real files deliver karenge |
| `RAZORPAY_API_BASE` | `""` | `""` (**kabhi set nahi**) | Prod mein boot fail |
| `EMAIL_API_URL` | `""` | `""` (**kabhi set nahi**) | Prod mein boot fail |
| `LEGACY_ORDERS_ENABLED` | `""` | `""` (khaali chhodo) | Legacy route retired; prod mein waise bhi off |
| `ALLOW_LOCAL_BACKEND_URL` | `"true"` (dev mein localhost ke liye) | `""` (**khaali — kabhi `true` nahi prod mein**) | Prod mein `true` pe loud boot warning |

---

<a id="frontend-master"></a>
## 3. MASTER TABLE — Frontend variables (`frontend/.env` local / Vercel frontend project)

> **Local:** `frontend/.env` file banao (`.env.example` se copy).
> **Production:** Vercel → aapka **frontend project** → Settings → Environment Variables.

| Variable | LOCAL value | PRODUCTION value | Note |
|---|---|---|---|
| `BACKEND_URL` | `http://localhost:3001` | `https://aapka-backend.vercel.app` | Backend ka URL — local pe 3001 port, prod pe backend Vercel URL |
| `INTERNAL_API_KEY` | (backend wali **SAME** value) | (backend wali **SAME** value) | **EXACT match** zaroori — mismatch pe har API call refuse |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | `https://aapka-domain.com` | Sitemap/OG/meta links isi se bante hain |
| `NEXT_PUBLIC_SUPPORT_PHONE` | `""` (khaali — line chhup jayegi, koi error nahi) | `+91-XXXXXXXXXX` (aapka phone/WhatsApp) | Optional — legal Contact page pe dikhega |
| `NEXT_PUBLIC_LEGAL_OWNER_NAME` | `""` | `""` (default "Azaz Mohammad" already committed) | Optional override |
| `NEXT_PUBLIC_BUSINESS_ADDRESS` | `""` | `""` (default already committed) | Optional override |
| `NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME` | `""` | `""` (default already committed) | Optional override |
| `NEXT_PUBLIC_LEGAL_JURISDICTION` | `""` | `""` (default already committed) | Optional override |

**Frontend mein ye sab KABHI set mat karna (galat belief):**
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` — NOT needed (backend serve karta hai via `/api/payments/config`)
- `IMAGEKIT_*` keys — NOT needed on frontend (backend signing route deta hai)
- `RESEND_API_KEY` / `R2_*` / `RAZORPAY_KEY_SECRET` — kabhi frontend pe nahi (ye sab backend secrets hain)

---

<a id="local-steps"></a>
## 4. Step-by-step: LOCAL testing setup (aapke laptop par)

### Step 1 — Project clone aur dependencies install

```bash
git clone <aapka-repo> sibra-digital-hub
cd sibra-digital-hub

# Backend deps
cd backend
bun install

# Frontend deps
cd ../frontend
bun install
```

### Step 2 — Neon database banao (free tier, 2 minute)

1. **neon.tech** pe account banao → **Create Project**
2. Dashboard se 2 connection strings copy karo:
   - **Pooled** (hostname mein `-pooler`) → ye `DATABASE_URL`
   - **Direct** (bina `-pooler`) → ye `DIRECT_URL`
3. Dono mein `?sslmode=require` hona chahiye (Neon default deta hai)

### Step 3 — 5 secrets generate karo

Terminal mein Section 1 ke 5 `openssl` commands chalao. Har output ko ek safe jagah note karo (password manager best).

### Step 4 — `backend/.env` file banao

```bash
cd backend
cp .env.example .env
```

Ab `.env` ko editor mein kholo aur Master Table (Section 2) ke **LOCAL** columns ke hisaab se values bharo. Zaroori ones:
- `DATABASE_URL` + `DIRECT_URL` (Step 2 se)
- `ENCRYPTION_KEY` + `SESSION_PEPPER` (Step 3 se)
- `INTERNAL_API_KEY` (Step 3 se — yaad rakho, frontend mein bhi yahi lagega)
- `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_MODE="test"` (Razorpay **Test** dashboard se)
- `PUBLIC_WEB_URL="http://localhost:3000"`
- `ALLOW_LOCAL_BACKEND_URL="true"` (localhost ke liye)
- Baaki khaali/default chhodo (email console driver chalega, R2/ImageKit khaali OK)

### Step 5 — Database tables banao (migration)

```bash
cd backend
bun run db:push        # ya: bunx prisma migrate deploy
```

Ye Prisma schema ko DB mein tables bana dega. Output mein koi error nahi hona chahiye.

### Step 6 — First admin account banao

```bash
cd backend
bun run admin:create
```

Ye aapse admin email + password poochega. Ye yaad rakho — isse login karoge.

### Step 7 — `frontend/.env` file banao

```bash
cd frontend
cp .env.example .env
```

Values bharo (Section 3 LOCAL column ke hisaab se):
- `BACKEND_URL="http://localhost:3001"`
- `INTERNAL_API_KEY` (Step 3 wali **SAME** value — backend se match karna chahiye)
- `NEXT_PUBLIC_SITE_URL="http://localhost:3000"`

### Step 8 — Dono servers start karo

**Terminal 1 (backend):**
```bash
cd backend
bun run dev          # port 3001 pe chalega
```

**Terminal 2 (frontend):**
```bash
cd frontend
bun run dev          # port 3000 pe chalega
```

### Step 9 — Store kholo aur test karo

Browser mein `http://localhost:3000` kholo. Store dikh jayegi.

**Payment test (TEST mode — fake paisa):**
- Product kholo → Buy dabao → Razorpay checkout khulega (test mode ka UI)
- **Test card success:** `4111 1111 1111 1111`, koi future expiry (12/30), koi CVV, koi naam
- **Test UPI success:** VPA `success@razorpay`
- Pay karo → thank-you page pe download dikhega → admin console (`/#/admin`) mein order paid dikhega
- Email local mein console mein log hogi (terminal 1 ke logs mein dekho — masked recipient + subject)

### Step 10 — (Optional) Webhook local testing via ngrok

Razorpay ka server localhost ko hit nahi kar sakta. Local webhook test ke liye:

```bash
# Terminal 3
ngrok http 3001
```

Ngrok ek public URL dega (jaise `https://abc123.ngrok.io`). Ye URL Razorpay **Test** dashboard → Webhooks mein daalo:
- URL: `https://abc123.ngrok.io/api/razorpay/webhook`
- Secret: aapki `RAZORPAY_WEBHOOK_SECRET` value
- Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`

Ab Razorpay ke webhooks aapke local backend pe aayenge.

---

<a id="prod-steps"></a>
## 5. Step-by-step: VERCEL production deploy (live server)

### Step 0 — Razorpay account activate karo (sabse pehle)

1. **razorpay.com** → account banao → **KYC/business activation** complete karo (business details, bank account, PAN)
2. Live keys + real payments **sirf activation ke baad** milte hain
3. International payments chahiye → Razorpay support se **International Payments activation** request karo (approval mein time lagta)

### Step 1 — Neon database (agar local wala reuse kar rahe ho to nahi, warna naya banao)

Production ke liye Neon ka same ya naya project. `DATABASE_URL` (pooled) + `DIRECT_URL` (direct) copy karo.

### Step 2 — NAYE production secrets generate karo

Section 1 ke 5 commands **dobara** chalao — local wale values **copy mat karo**. Production ke liye fresh:
- `ENCRYPTION_KEY` (naya)
- `SESSION_PEPPER` (naya)
- `INTERNAL_API_KEY` (naya — yaad rakho, frontend mein bhi yahi)
- `CRON_SECRET` (naya)
- `RAZORPAY_WEBHOOK_SECRET` (naya)

### Step 3 — Backend Vercel project banao

1. **vercel.com** → dashboard → **Add New Project**
2. Aapka GitHub repo import karo
3. **Root Directory = `backend`** set karo (zaroori — repo mein frontend/ aur backend/ dono hain)
4. **Environment Variables** mein Section 2 ke **PRODUCTION** columns ki saari values daalo (Groups A–I)
5. **Deploy** dabao

Build automatically `prisma migrate deploy` chalayega (`backend/vercel.json` mein configured). Deploy hone ke baad ek URL milega (jaise `https://sibra-backend.vercel.app`) — **iska note rakho**, ye frontend ka `BACKEND_URL` banega.

### Step 4 — Frontend Vercel project banao

1. Vercel dashboard → **Add New Project** → same GitHub repo import karo
2. **Root Directory = `frontend`** set karo
3. **Environment Variables** mein Section 3 ke **PRODUCTION** columns ki values daalo:
   - `BACKEND_URL` = Step 3 ka backend URL
   - `INTERNAL_API_KEY` = backend wali **SAME** value
   - `NEXT_PUBLIC_SITE_URL` = aapka final domain
   - `NEXT_PUBLIC_SUPPORT_PHONE` (optional)
4. **Deploy** dabao → aapka store live URL milega

### Step 5 — First admin account banao (production)

Apne computer ke terminal se (Neon ki **direct** URL use karo):

```bash
cd backend
DATABASE_URL="<Neon direct URL>" DIRECT_URL="<Neon direct URL>" bun run admin:create
```

Admin email + password set karo. Phir `https://aapka-domain.com/#/admin` pe login karo → **2FA setup** (Google Authenticator etc.) → **recovery codes download karke save karo** (ye password ke barabar sensitive — khoye to lockout).

### Step 6 — Razorpay LIVE webhook configure karo

1. Razorpay Dashboard → **Live mode** select karo (top-right toggle)
2. **Account Settings → Webhooks → Add New Webhook**
3. Fields bharo:
   - **Webhook URL:** `https://<aapka-backend-vercel-url>/api/razorpay/webhook`
   - **Secret:** aapki `RAZORPAY_WEBHOOK_SECRET` value (env var mein jo daali)
   - **Active Events:** `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`
4. **Save** dabao

### Step 7 — External cron scheduler set up karo

`backend/vercel.json` mein Vercel-cron configured nahi hai, isliye ek **external scheduler** chahiye (**cron-job.org** free hai, ya **GitHub Actions**). Har **10–15 minute** mein ye 2 URLs hit karwao:

```
GET/POST  https://<aapka-backend-url>/api/cron/reconcile-payments
GET/POST  https://<aapka-backend-url>/api/cron/retry-emails
```

**Header dono mein:** `Authorization: Bearer <aapki CRON_SECRET value>`

Ye webhook miss hue payments ko automatically fulfill karega (backup path).

### Step 8 — Health check

Browser mein `https://<aapka-backend-url>/api` kholo. Response mein ye hona chahiye:
```json
{ "demoMode": false, "testPaymentsAllowed": false, ... }
```

Agar `true` dikhe = koi danger variable (Section 2 Group J) env mein chhoot gaya hai. Vercel build logs mein bhi dekho — koi `PRODUCTION BOOT WITH MOCK/SANDBOX FLAGS` banner **nahi** hona chahiye.

### Step 9 — LIVE payment test (₹1 method)

Live mode mein koi fake instrument nahi — **real paisa** lagta hai.

1. Admin console (`/#/admin` → Products) mein apna **sabse sasta product temporarily ₹1** kar do
2. Store kholo → us product ko apne UPI/card se khareedo (₹1 real payment)
3. Verify karo:
   - Razorpay **Live** dashboard → Payments mein `captured` dikhe
   - Vercel → backend → Logs mein webhook `200 OK` dikhe
   - Thank-you page pe download button dikha
   - Customer ko **email aayi** (download link ke saath)
   - Admin console → Orders mein status **paid** hai
4. **Refund test:** Razorpay dashboard → Payments → us ₹1 ko refund karo → customer ka download access revoke ho jayega
5. Product price **wapas real price** kar do
6. Note: refund par chhota gateway fee (kuch rupaye) non-refundable reh sakta hai — ye normal hai

### Step 10 — (Optional) International checkout enable

Jab Razorpay se **International Payments activation** confirm ho jaye:
- Backend env mein `INTERNATIONAL_CHECKOUT_ENABLED="true"` set karo → redeploy
- Admin console mein product ki USD base price set karo; international native-currency prices daily cached Frankfurter reference rate se calculate hoti hain. Razorpay account mein enabled currency codes ko `RAZORPAY_FOREIGN_CURRENCIES` mein list karo.

---

<a id="verify"></a>
## 6. Quick verification checklist

### Local testing ke baad check karo:
- [ ] `http://localhost:3000` pe store khul rahi hai
- [ ] `http://localhost:3000/#/admin` pe admin login ho raha hai
- [ ] Test card `4111 1111 1111 1111` se payment ho raha hai
- [ ] Thank-you page pe download dikha
- [ ] Backend terminal mein email console log dikh raha hai
- [ ] Admin → Orders mein order "paid" hai

### Production deploy ke baad check karo:
- [ ] `https://<backend-url>/api` → `demoMode:false, testPaymentsAllowed:false`
- [ ] Vercel build logs mein koi MOCK/SANDBOX banner nahi
- [ ] `https://aapka-domain.com` pe store live
- [ ] Admin login + 2FA working
- [ ] Razorpay Live webhook configured (dashboard mein delivery `200 OK`)
- [ ] External cron scheduler set (2 endpoints, Bearer token)
- [ ] ₹1 live payment + refund test successful
- [ ] `INTERNAL_API_KEY` backend + frontend mein EXACT same
- [ ] `RAZORPAY_MODE="live"` aur key prefix `rzp_live_` match
- [ ] Saare 6 danger variables (Group J) khaali/unset
- [ ] `PAYMENT_ALERT_EMAIL` set
- [ ] `RAZORPAY_BLOCK_INTERNATIONAL_CARDS="true"`

---

## Ek line mein summary

> **Local testing:** Neon DB + 5 `openssl` secrets + Razorpay **test** keys (`rzp_test_`, `RAZORPAY_MODE="test"`) + email console driver (khaali `RESEND_API_KEY`) + `ALLOW_LOCAL_BACKEND_URL="true"` + `ADMIN_REQUIRE_2FA="false"` (dev convenience). **Production:** Neon DB + 5 **NAYE** secrets + Razorpay **live** keys (`rzp_live_`, `RAZORPAY_MODE="live"`) + Resend (`EMAIL_PROVIDER="resend"` + verified domain `EMAIL_FROM` + `RESEND_API_KEY`) + `ADMIN_REQUIRE_2FA="true"` + `CRON_SECRET` set + external cron scheduler + Razorpay live webhook + `PAYMENT_ALERT_EMAIL` + `RAZORPAY_BLOCK_INTERNATIONAL_CARDS="true"` + 6 danger variables kabhi set nahi. Har variable ka exact local/prod value Section 2–3 ki master tables mein hai.
