// ═══════════════════════════════════════════════════════════
// CLI input helper for the admin break-glass scripts.
// • TTY      → interactive readline (owner experience)
// • piped    → read all of stdin upfront, consume line-by-line
//              (Node's readline over pipes can silently drop
//              pending questions at EOF — pre-reading is safe)
// ═══════════════════════════════════════════════════════════

import readline from 'node:readline/promises'
import { readFileSync } from 'node:fs'

const isTty = process.stdin.isTTY === true

let pipedLines: string[] = []
let pipedIndex = 0

if (!isTty) {
  try {
    const raw = readFileSync(0, 'utf8')
    pipedLines = raw.split(/\r?\n/).map((l) => l.trim())
  } catch {
    pipedLines = []
  }
}

/** Ask one question. Returns the trimmed answer (never undefined). */
export async function ask(prompt: string): Promise<string> {
  if (isTty) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      return (await rl.question(prompt)).trim()
    } finally {
      rl.close()
    }
  }
  const line = pipedLines[pipedIndex] ?? ''
  pipedIndex += 1
  process.stdout.write(`${prompt}${line ? '•••' : ''}\n`)
  return line
}
