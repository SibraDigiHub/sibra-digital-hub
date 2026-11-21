import { SITE_NAME, siteUrl } from "@/lib/site";
import { getAllPublishedProducts, getCategories } from "@/lib/seo-data";
import { REAL_LEGAL_PAGES } from "@/lib/real-routes";

// ─────────────────────────────────────────────────────────────
// /llms.txt — the llms.txt convention (markdown: H1 site name,
// blockquote summary, then H2 sections of `- [Page](URL): description`
// links) so AI assistants can index the public pages.
//
// Served by a route handler (not a static file) because every link must
// be an ABSOLUTE URL built from the NEXT_PUBLIC_SITE_URL env var, and
// the product/category lists come from the live catalog (ISR — short
// revalidate, never stale, never hard-coded).
//
// Only real, public pages are listed (now the REAL routes: /shop,
// /category/…, /product/…, /privacy…). Private/transactional views
// (admin, thank-you, download/watch tokens, reset-password) and APIs
// are deliberately excluded. about/pricing have no real route — their
// hash links stay, marked as such.
// ─────────────────────────────────────────────────────────────

export const revalidate = 60;

const LEGAL_DESCRIPTIONS: Record<string, string> = {
  privacy: "Plain-words summary of what is collected when you shop — payment details never touch the site's servers.",
  terms: "The rules for buying and using these digital products.",
  "refund-policy": "Fair, simple refund promise for instant digital goods — unused orders are refunded within 7 days.",
  contact: "Order help, delivery problems, refunds and general questions — replies within 24 hours, 7 days a week.",
};

export async function GET(): Promise<Response> {
  const base = siteUrl();
  const [products, categories] = await Promise.all([getAllPublishedProducts(), getCategories()]);

  // Key products first (featured order), capped so the file stays short.
  const keyProducts = [...products]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder)
    .slice(0, 10);

  const categoryLines = categories
    .map(
      (c) =>
        `- [${c.label}](${base}/category/${c.zone}/${c.slug}): ${c.zone === "kids" ? "Kids zone" : "Creator hub"} category — instant digital downloads.`,
    )
    .join("\n");

  const productLines = keyProducts
    .map((p) => {
      const price = `India base price ₹${Math.round(p.priceInr)}; USD base price $${p.priceUsd.toFixed(2)}`;
      return `- [${p.title}](${base}/product/${p.slug}): ${p.description.trim() || "Instant digital download"} — ${price}. International checkout may use a merchant-enabled local currency converted from the USD base price.`;
    })
    .join("\n");

  const legalLines = REAL_LEGAL_PAGES.map(
    (page) => `- [${LEGAL_DESCRIPTIONS[page] ? page.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : page}](${base}/${page}): ${LEGAL_DESCRIPTIONS[page]}`,
  ).join("\n");

  const body = `# ${SITE_NAME}

> Two worlds, one checkout: Digital Kidosphere (curated by Professor Sibra Naaz) for joyful kids' printables, and the Creator & Developer Hub for premium Canva templates, AI prompts, scripts & UI kits. Instant downloads — pay by card, UPI, net banking & more via Razorpay.

Every product has its own crawlable page under ${base}/product/<slug>, and the catalog lives at ${base}/shop. Every product is an instant digital download.

## Main pages

- [Gateway (home)](${base}/): 3D split gateway — choose the Kids or the Creator world to enter the hub.
- [Kids zone — Digital Kidosphere](${base}/shop?zone=kids): Joyful kids' printables — coloring books, activity & puzzles, story e-books, ABCD & number tracing, flashcards & crafts, and parents' guides.
- [Creator hub — Creator & Developer Hub](${base}/shop?zone=creator): Premium Canva templates, AI prompts, motion assets, scripts & automations, website UI kits and ATS resumes.
- [Universal catalog](${base}/shop): All products across both zones with search, category filters and sorting.

## Categories

${categoryLines}

## Key products

${productLines}

## Product format and fulfilment facts

- Kids' printables (coloring books, activity & puzzle packs, story e-books, ABCD & number tracing sheets, flashcards) ship as 300 DPI print-ready PDF interiors with 600 DPI digital cover files.
- Creator-hub assets ship in the format listed on each product page: Canva template frameworks, structural AI prompt packs, production video scripts, ATS-compliant resume documents, and Next.js/PostgreSQL web application source code.
- Every order is an automated instant download: the download link is emailed the moment payment is captured — no shipping, no waiting period.
- Checkout runs on Razorpay and PayPal: UPI, cards, net banking and wallets for India; international cards and PayPal worldwide.
- Prices: India uses INR base prices; international checkout uses USD base prices (or a merchant-enabled local currency converted from the USD base price).
- Platform infrastructure: custom Next.js + Tailwind CSS frontend, PostgreSQL database, ImageKit CDN for image assets.

## Support and policies

${legalLines}

- [About Us](${base}/#/about): Who runs ${SITE_NAME}, what it sells and how instant digital delivery works.
- [Pricing Details](${base}/#/pricing): How prices work — India uses INR base prices; international checkout uses a merchant-enabled local currency when available, otherwise USD, with daily FX conversion from the USD base price.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
