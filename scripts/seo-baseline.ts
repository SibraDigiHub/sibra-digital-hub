// Baseline capture: screenshots (1440 + 390) + cold-load JS bytes per page
// for the SEO real-URLs task. Run against a PRODUCTION server (next start).
// Usage: bun run scripts/seo-baseline.ts <outdir>
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const CHROME = process.env.SEO_CHROME_PATH ?? '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'
const OUT = process.argv[2] ?? '/tmp/baseline'
const BASE = 'http://127.0.0.1:3000'

const PAGES: { name: string; url: string }[] = [
  { name: 'gateway', url: `${BASE}/` },
  { name: 'shop-kids', url: `${BASE}/#/shop?zone=kids` },
  { name: 'shop-creator', url: `${BASE}/#/shop?zone=creator` },
  { name: 'product', url: `${BASE}/#/product/baby-animals-coloring-book` },
  { name: 'legal-privacy', url: `${BASE}/#/privacy` },
]

const VIEWPORTS = [
  { tag: '1440', width: 1440, height: 900 },
  { tag: '390', width: 390, height: 844 },
]

interface PageStats { name: string; viewport: string; jsBytes: number; consoleErrors: string[] }

async function capturePage(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  vp: { tag: string; width: number; height: number },
  p: { name: string; url: string },
): Promise<PageStats> {
  // Fresh context per page — cold-load numbers per URL (no shared chunk cache)
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140)) })
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 140)}`))

  let jsBytes = 0
  const onResponse = (r: { url(): string; body(): Promise<Buffer | null> }): void => {
    if (!/\.js(\?|$)/.test(r.url()) || !r.url().includes(BASE)) return
    void r.body().then((b) => {
      jsBytes += b?.length ?? 0
    }).catch(() => {})
  }
  page.on('response', onResponse)
  await page.goto(p.url, { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(3000) // SPA hydration + data fetches + lazy chunks
  await page.screenshot({ path: `${OUT}/${p.name}-${vp.tag}.png`, animations: 'disabled' })
  page.off('response', onResponse)
  await ctx.close()
  return { name: p.name, viewport: vp.tag, jsBytes, consoleErrors }
}

async function capture(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<PageStats[]> {
  const stats: PageStats[] = []
  for (const vp of VIEWPORTS) {
    for (const p of PAGES) {
      stats.push(await capturePage(browser, vp, p))
    }
  }
  return stats
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: CHROME })
  const stats = await capture(browser)
  await browser.close()
  console.log('── BASELINE STATS ──')
  for (const s of stats) {
    console.log(`${s.name} [${s.viewport}]: jsBytes=${s.jsBytes} consoleErrors=${s.consoleErrors.length}`)
    for (const e of s.consoleErrors.slice(0, 3)) console.log(`   ✗ ${e}`)
  }
}

void main()
