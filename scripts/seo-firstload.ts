// First-Load JS measurement: sums ONLY the JS that loads up to (and
// including) the window load event — the true eager payload, excluding
// idle-time lazy chunks (three.js scene etc.). Same method both branches.
import { chromium } from 'playwright'

const CHROME = process.env.SEO_CHROME_PATH ?? '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'
const BASE = process.argv[2] ?? 'http://localhost:3000'

const PAGES: { name: string; url: string }[] = [
  { name: 'home', url: `${BASE}/` },
  { name: 'shop', url: `${BASE}/shop?zone=kids` },
  { name: 'product', url: `${BASE}/product/baby-animals-coloring-book` },
  { name: 'privacy', url: `${BASE}/privacy` },
]

async function measure(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<number> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  let bytes = 0
  let loadFired = false
  page.on('response', (r) => {
    if (!/\.js(\?|$)/.test(r.url()) || !r.url().includes(new URL(BASE).host)) return
    void r.body().then((b) => {
      if (!loadFired) bytes += b?.length ?? 0
    }).catch(() => {})
  })
  await page.goto(url, { waitUntil: 'load', timeout: 45000 })
  loadFired = true
  await page.waitForTimeout(400)
  await ctx.close()
  return bytes
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME })
  for (const p of PAGES) {
    const b = await measure(browser, p.url)
    console.log(`${p.name}: ${b}`)
  }
  await browser.close()
}

void main()
