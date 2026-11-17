// ═══════════════════════════════════════════════════════════
// Parse JSON-string columns returned by the products API.
// Shared by client code (catalog/detail views) and server-only
// SEO data helpers — lives OUTSIDE the 'use client' store module
// so server components can import it without a client boundary.
// ═══════════════════════════════════════════════════════════

export function parseProduct(raw: Record<string, unknown>) {
  const j = (v: unknown, fb: unknown) => {
    try {
      return v ? JSON.parse(v as string) : fb
    } catch {
      return fb
    }
  }
  return {
    ...raw,
    images: j(raw.images, []) as string[],
    tags: j(raw.tags, []) as string[],
    fileFormats: j(raw.fileFormats, []) as string[],
    platformLinks: j(raw.platformLinks, []) as { platform: string; url: string }[],
    whatsInside: j(raw.whatsInside, []) as string[],
    spatialCoords: j(raw.spatialCoords, { x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number },
  }
}
