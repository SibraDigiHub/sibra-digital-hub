import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cinzel, Playfair_Display, Plus_Jakarta_Sans, JetBrains_Mono, Baloo_2 } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import HashRedirect from "@/components/real/HashRedirect";
import { siteUrl } from "@/lib/site-url";

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700", "800"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  display: "swap",
});

// T8 (§9.1): full Metadata API for the single-route storefront.
// Hash-router note: catalog/product/legal views live under #/… fragments, so
// SITE-LEVEL tags only (per-product share previews need real routes — future
// task). Absolute URLs are derived from the ACTUAL request origin
// (X-Forwarded-Host / Host + X-Forwarded-Proto) so social crawlers
// (WhatsApp/Facebook/X) always get a publicly reachable og:image — a
// localhost origin (dev/sandbox preview) would make the share image
// unfetchable and previews would show text only. A non-localhost
// NEXT_PUBLIC_SITE_URL still pins the origin in production (owner sets it;
// see Question_Answer.md Q7).
//
// Icons/manifest use Next file conventions — src/app/icon.svg +
// src/app/icon.png (owner's Neon-Gold Cosmic Knowledge Crest), src/app/manifest.ts
// (PWA icons at public/icons). The owner's 1200×630 share cover is wired as
// CONFIG-based openGraph/twitter images pointing at the public asset
// /brand/og-cover.png. The former file-convention opengraph-image files
// (opengraph-image.tsx/.png/.alt.txt) were REMOVED on purpose: Next gives
// file-convention images precedence over config openGraph.images, so og:image
// kept resolving to the runtime monogram route instead of the owner's cover
// (and file-convention URLs pinned to localhost in dev, breaking WhatsApp/
// social previews on proxied previews). With only config images left, BOTH
// og:image and twitter:image resolve to /brand/og-cover.png against the
// request-derived metadataBase on every platform (WhatsApp/Telegram/Facebook/X).
// src/app/apple-icon.png covers
// the iOS apple-touch-icon. Owner brand assets — see public/brand/ for the kit.

// Origin resolution order: non-local request host (gateway/preview proxy) →
// NEXT_PUBLIC_SITE_URL env pin → siteUrl() localhost fallback.
async function metadataOrigin(): Promise<string> {
  const envUrl = siteUrl();
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwarded || h.get("host")?.trim() || "";
    if (!host) return envUrl;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(host)) {
      return envUrl;
    }
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    return `${proto}://${host}`;
  } catch {
    return envUrl;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = new URL(await metadataOrigin());
  return {
    metadataBase,
    title: {
      default: "Sibra Digital Hub — Digital Kidosphere & Creator Hub",
      template: "%s · Sibra Digital Hub",
    },
    description:
      "Two worlds, one checkout: joyful kids' printables & premium creator assets — Canva templates, AI prompts, scripts & UI kits. Instant downloads — card, UPI, net banking & more via Razorpay.",
    applicationName: "Sibra Digital Hub",
    keywords: [
      "kids coloring books",
      "printable activities",
      "AI prompts",
      "Canva templates",
      "digital downloads",
      "instant download",
      "Sibra Digital Hub",
      "Sibra Kids",
    ],
    authors: [{ name: "Sibra Digital Hub" }],
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      siteName: "Sibra Digital Hub",
      title: "Sibra Digital Hub — Digital Kidosphere & Creator Hub",
      description:
        "Joyful kids printables & premium creator assets. Instant downloads. Pay by card, UPI, net banking & more via Razorpay.",
      url: "/",
      locale: "en_IN",
      images: [
        {
          url: "/brand/og-cover.png",
          width: 1200,
          height: 630,
          type: "image/png",
          alt: "Sibra Digital Hub — SDH neon-gold cosmic crest with kids and creators. Digital products for kids and creators — instant downloads, pay by card, UPI, net banking & more via Razorpay.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Sibra Digital Hub — Digital Kidosphere & Creator Hub",
      description:
        "Joyful kids printables & premium creator assets. Instant downloads. Pay by card, UPI, net banking & more via Razorpay.",
      images: ["/brand/og-cover.png"],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050706",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${cinzel.variable} ${playfair.variable} ${jakarta.variable} ${jetbrains.variable} ${baloo.variable} antialiased`}
      >
        {/* Legacy /#/… links → real URLs (once per page load; hash views
            without a real route are untouched). Renders nothing. */}
        <HashRedirect />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
