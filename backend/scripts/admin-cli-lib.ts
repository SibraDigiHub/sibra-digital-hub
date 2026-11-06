// ═══════════════════════════════════════════════════════════
// T4 break-glass CLI shared helpers (admin:create / admin:reset-password /
// admin:reset-2fa). Reads DATABASE_URL from the environment, requires the
// admin email twice, prints NOTHING secret, writes an audit row.
// ═══════════════════════════════════════════════════════════

import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export interface Flags {
  email?: string
  emailAgain?: string
  password?: string
  name?: string
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--email') flags.email = next()
    else if (a === '--email-again' || a === '--confirm-email') flags.emailAgain = next()
    else if (a === '--password') flags.password = next()
    else if (a === '--name') flags.name = next()
  }
  return flags
}

/** The sandbox/CI must never point the CLI at a file-based (non-Postgres) database. */
export function assertPostgresEnv(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('postgres')) {
    console.error('ERROR: DATABASE_URL must be a PostgreSQL connection string for admin CLI tools.')
    console.error('Example: DATABASE_URL="postgresql://postgres@127.0.0.1:5432/sibra" bun run admin:create')
    process.exit(1)
  }
}

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/** Hidden input when the terminal supports raw mode; visible fallback otherwise. */
export async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) return prompt(question)
  stdout.write(question)
  const chars: Buffer[] = []
  const wasRaw = stdin.isRaw
  try {
    stdin.setRawMode(true)
    stdin.resume()
    await new Promise<void>((resolve) => {
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 0x03) process.exit(1) // Ctrl-C
          if (byte === 0x0d || byte === 0x0a) {
            stdin.off('data', onData)
            resolve()
            return
          }
          if (byte === 0x7f || byte === 0x08) chars.pop()
          else chars.push(Buffer.from([byte]))
        }
      }
      stdin.on('data', onData)
    })
  } finally {
    try {
      stdin.setRawMode(wasRaw)
      stdin.pause()
    } catch {
      /* non-tty */
    }
  }
  stdout.write('\n')
  return Buffer.concat(chars).toString('utf8').trim()
}

export async function requireEmailTwice(flags: Flags): Promise<string> {
  let email = flags.email
  let again = flags.emailAgain
  if (!email || !again) {
    if (!email) email = await prompt('Admin email: ')
    if (!again) again = await prompt('Confirm email: ')
  }
  const a = (email ?? '').trim().toLowerCase()
  const b = (again ?? '').trim().toLowerCase()
  if (!a || !b) {
    console.error('ERROR: email is required (typed/flagged twice).')
    process.exit(1)
  }
  if (a !== b) {
    console.error('ERROR: the two email entries do not match.')
    process.exit(1)
  }
  return a
}

export async function requirePassword(flags: Flags, check: (pw: string, email?: string) => { ok: boolean; reason?: string }, email?: string): Promise<string> {
  let password = flags.password
  if (!password) {
    password = await promptHidden('New password (input hidden, ≥12 chars): ')
    const confirm = await promptHidden('Confirm password: ')
    if (password !== confirm) {
      console.error('ERROR: passwords do not match.')
      process.exit(1)
    }
  }
  const res = check(password, email)
  if (!res.ok) {
    console.error(`ERROR: ${res.reason}`)
    process.exit(1)
  }
  return password
}

export function done(message: string): never {
  console.log(message)
  process.exit(0)
}
