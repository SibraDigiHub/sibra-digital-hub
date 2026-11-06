// ═══════════════════════════════════════════════════════════
// Labelled entry point for the destructive-test guard.
// Destructive suites import this file so refusal messages name
// the suite that asked to run (see tests/_guard.ts for the law).
// ═══════════════════════════════════════════════════════════

import { assertDestructiveAllowed } from '../_guard'

assertDestructiveAllowed(process.env.DESTRUCTIVE_GUARD_LABEL ?? 'a security regression suite')
