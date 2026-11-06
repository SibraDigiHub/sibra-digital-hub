import type { NextConfig } from "next";

// Sibra Digital Hub — frontend.
// All client code calls relative /api/* routes; in development (and on any
// single-origin deployment) they are proxied server-side to the backend app.
// On Vercel set BACKEND_URL to the backend deployment URL.
// T9: API_INTERNAL_URL is accepted as an alias (spec §10.2 name) — the code
// reads BACKEND_URL; either name works, BACKEND_URL wins when both are set.
const BACKEND_URL =
  process.env.BACKEND_URL || process.env.API_INTERNAL_URL || "http://localhost:3001";

// DEPLOYMENT guard: a production build with a missing or localhost backend
// URL would ship a proxy that cannot work — every /api call would 502 at
// best (the catch-all route falls back to a stale internal port). Fail the
// BUILD with an actionable message instead (Vercel surfaces it directly).
// Local production-mode smoke tests opt out with ALLOW_LOCAL_BACKEND_URL=true
// (documented in docs/DEPLOYMENT.md); dev (`next dev`) never hits this.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_BACKEND_URL !== "true") {
  const raw = process.env.BACKEND_URL || process.env.API_INTERNAL_URL;
  const host = (() => {
    try {
      return new URL(raw ?? "").hostname;
    } catch {
      return null;
    }
  })();
  const isLocal =
    !!host &&
    (host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local"));
  if (!raw || !host) {
    throw new Error(
      "[frontend build] BACKEND_URL is not set (or is not a valid URL). " +
        "Set BACKEND_URL to the backend deployment URL, e.g. https://sibra-backend.vercel.app " +
        "(the API_INTERNAL_URL alias is also accepted). " +
        "For a LOCAL production-mode smoke test set ALLOW_LOCAL_BACKEND_URL=true.",
    );
  }
  if (isLocal) {
    throw new Error(
      `[frontend build] BACKEND_URL points at a local address ("${raw}"). ` +
        "Production builds must target the deployed backend URL. " +
        "Set BACKEND_URL to e.g. https://sibra-backend.vercel.app, or set " +
        "ALLOW_LOCAL_BACKEND_URL=true for a LOCAL production-mode smoke test.",
    );
  }
}

// T9 (§10.2): no `output: "standalone"` on Vercel — the platform builds and
// serves Next.js itself. Locally (and in the temp-copy build check) the
// standalone output is still produced for `start:standalone`; on Vercel the
// VERCEL env var is always set, so the property is dropped there.
const output = process.env.VERCEL ? undefined : ("standalone" as const);

// T7 (§8.4): Content-Security-Policy in REPORT-ONLY mode. Nothing is
// blocked; violations are console-reported so every page (3D canvas,
// flip cards, video, Razorpay, admin) can be exercised first.
//
// OWNER ACTION to enforce: after testing, rename the header to
// `Content-Security-Policy` (one line below) — no directive changes.
// Directives (survey of actual external origins used by the UI):
//   script-src  — self + Razorpay Checkout (checkout.js) origins. NO unsafe-eval
//                 (must also stay out of the final enforce list).
//   style-src   — 'unsafe-inline' required by Next/Tailwind inline styles.
//   img/media   — self + data:/blob: (canvas/three.js) + ImageKit CDN.
//   connect-src — self + Razorpay APIs + ImageKit upload/CDN.
//   frame-src   — self + Razorpay checkout frames +
//                 youtube-nocookie embeds (CreatorCard / ProductDetailView /
//                 admin ProductForm preview embed YouTube — kept so no
//                 feature breaks).
//   worker-src  — self + blob: (three.js/workers); object-src 'none'.
//   frame-ancestors 'none' + X-Frame-Options: DENY (clickjacking).
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com https://*.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://ik.imagekit.io",
  "media-src 'self' data: blob: https://ik.imagekit.io",
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com https://*.razorpay.com https://upload.imagekit.io https://ik.imagekit.io",
  "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com https://www.youtube-nocookie.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// T7 (§8.3): security headers on every response this app serves.
// NOTE on X-Robots-Tag: the admin console lives on HASH routes (#/admin…)
// served from the single `/` HTML document — there are no /admin/* paths
// for the server to header-tag, so no per-path noindex header exists here
// (robots.txt already disallows /admin; JSON-LD/robots metadata come with T8).
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  // X-Frame-Options: DENY (clickjacking) — production builds ONLY.
  // Development preview panels embed the app in an iframe on another origin;
  // DENY makes browsers refuse to render it (blank preview panel). Production
  // (Vercel / `next build`) keeps DENY, so the live-site protection is intact.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "X-Frame-Options", value: "DENY" }]
    : []),
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  output,
  // Dev-only: the sandbox preview panel loads the app through the gateway
  // (http://127.0.0.1:81), which Next 16.4+ treats as a cross-origin host
  // and blocks /_next/hmr + dev font requests — hydration silently never
  // completes and the preview shows an empty shell. Listing the gateway
  // host restores the pre-16.4 preview behaviour. No production effect.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // T7 (§8.3): do not advertise the framework version.
  poweredByHeader: false,
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
