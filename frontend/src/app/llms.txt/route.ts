import { SITE_NAME } from "@/lib/site";
import { siteUrl } from "@/lib/site-url";
import { getCategoriesStrict, getFeaturedProducts } from "@/lib/seo-data";
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
  const [keyProducts, categories] = await Promise.all([getFeaturedProducts(10), getCategoriesStrict()]);

  const categoryLines = categories
    .map(
      (c) =>
        `- [${c.label}](${base}/category/${c.zone}/${c.slug}): Published products in the ${c.zone === "kids" ? "Kids zone" : "Creator hub"} category.`,
    )
    .join("\n");

  const productLines = keyProducts
    .map((p) => {
      const price = `India base price ₹${Math.round(p.priceInr)}; USD base price $${p.priceUsd.toFixed(2)}`;
      return `- [${p.title}](${base}/product/${p.slug}): ${p.description.trim() || "See the product page for details"} — ${price}. International checkout may use a merchant-enabled local currency converted from the USD base price.`;
    })
    .join("\n");

  const legalLines = REAL_LEGAL_PAGES.map(
    (page) => `- [${LEGAL_DESCRIPTIONS[page] ? page.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : page}](${base}/${page}): ${LEGAL_DESCRIPTIONS[page]}`,
  ).join("\n");

  const body = `# ${SITE_NAME}

> Two worlds, one store: Digital Kidosphere (curated by Professor Sibra Naaz) for kids' printables, and the Creator & Developer Hub for Canva templates, AI prompts, scripts & UI kits.

Every published product has its own crawlable page under ${base}/product/<slug>. Browse the Kids and Creator catalogs separately, or use the XML sitemap to discover all published product URLs.

## Main pages

- [Gateway (home)](${base}/): 3D split gateway — choose the Kids or the Creator world to enter the hub.
- [Kids zone — Digital Kidosphere](${base}/shop?zone=kids): Joyful kids' printables — coloring books, activity & puzzles, story e-books, ABCD & number tracing, flashcards & crafts, and parents' guides.
- [Creator hub — Creator & Developer Hub](${base}/shop?zone=creator): Canva templates, AI prompts, motion assets, scripts & automations, website UI kits and ATS resumes.
- [XML sitemap](${base}/sitemap.xml): Complete crawlable URL inventory, including published product pages.

## Categories

${categoryLines}

## Key products

${productLines}

## Delivery and checkout

- The delivery method is product-specific and is described on its product page. Depending on the product settings, access may be a file download, protected watch access, or an external destination.
- Direct checkout uses Razorpay where the merchant has enabled it and the visitor's country/currency is supported. Some products may provide marketplace purchase links instead.
- Prices: India uses INR base prices; international checkout uses USD base prices or a merchant-enabled local currency converted from the USD base price.
- Platform infrastructure: custom Next.js + Tailwind CSS frontend, PostgreSQL database, ImageKit CDN for image assets.

## Support and policies

${legalLines}

`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
