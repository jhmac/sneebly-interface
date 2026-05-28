import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

// ─── Result shape ──────────────────────────────────────────────────────────────

export interface CompileResult {
  success: boolean
  errorText: string   // empty string when success === true; capped to MAX_ERRORS / MAX_CHARS
  errorCount: number  // total errors in raw output — may exceed MAX_ERRORS when capped
  wasCapped: boolean  // true if errorText is incomplete (error-count cap or char cap fired)
  durationMs: number
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_ERRORS = 10
const MAX_CHARS = 2000
const MAX_RAW_CHARS = 1_000_000  // 1 M chars — cap raw accumulation before capErrors runs
const TIMEOUT_MS = 60_000

// Matches any line that begins a tsc error entry.
// Exported so callers (e.g. phase-runner) can extract the first error line from
// a CompileResult.errorText without re-defining the pattern.
// Extracted so both the pre-check in runCompileCheck and the line scan in capErrors
// stay in sync if the pattern ever needs to change.
export const ERROR_LINE_RE = /error TS\d+/

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Run `tsc --noEmit` against the project root.
 *
 * Returns null when:
 * - No `tsconfig.json` at the project root (not a TypeScript project)
 * - No local `node_modules/.bin/tsc` (TypeScript not installed as a dep)
 * - tsc does not exit within 60 seconds
 * - tsc is killed by an external signal before exiting normally
 * - tsc exits non-zero with no output (infrastructure error, not fixable TS errors)
 * - tsc output has no `error TS####` lines (config error / internal tsc crash)
 * - The tsc process itself fails to spawn
 *
 * Returns CompileResult in all other cases:
 * - success === true  → zero errors
 * - success === false → errors found; errorText is capped to MAX_ERRORS / MAX_CHARS;
 *                       errorCount reflects the total before any capping;
 *                       wasCapped indicates whether errorText is incomplete
 *
 * The local binary is always used. Global tsc is never consulted — version mismatches
 * between global and local produce spurious errors that Claude cannot fix.
 */
export function runCompileCheck(projectPath: string): Promise<CompileResult | null> {
  // Requires a root-level tsconfig.json — projects without one use a different toolchain.
  if (!existsSync(join(projectPath, 'tsconfig.json'))) return Promise.resolve(null)

  // Requires a local tsc binary.
  const tscBin = join(projectPath, 'node_modules', '.bin', 'tsc')
  if (!existsSync(tscBin)) return Promise.resolve(null)

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let output = ''
    let settled = false

    // Typed as | undefined so clearTimeout(timer) is valid before the first assignment.
    // Assigned after child is created because the timeout callback calls child.kill().
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (value: CompileResult | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const child = spawn(tscBin, ['--noEmit'], {
      cwd: projectPath,
      // No shell — direct exec avoids shell injection and PATH surprises.
      shell: false,
      // Explicit pipe — makes it clear stdout/stderr are always non-null Readables.
      // No TTY → tsc automatically uses non-pretty plain-text output.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    timer = setTimeout(() => {
      child.kill()
      settle(null)
    }, TIMEOUT_MS)

    const onData = (chunk: Buffer) => {
      // Hard cap on raw accumulation — projects with thousands of errors could otherwise
      // build a multi-megabyte string before capErrors trims it to MAX_CHARS.
      if (output.length < MAX_RAW_CHARS) output += chunk.toString()
    }
    // tsc writes errors to stdout; capture stderr too for unexpected diagnostics.
    child.stdout!.on('data', onData)
    child.stderr!.on('data', onData)

    child.on('close', (code) => {
      const durationMs = Date.now() - startedAt

      if (code === null) {
        // Killed by an external signal. If our timer fired first, settled is
        // already true and this settle(null) is a no-op.
        settle(null)
        return
      }

      if (code === 0) {
        settle({ success: true, errorText: '', errorCount: 0, wasCapped: false, durationMs })
        return
      }

      const trimmed = output.trim()
      if (!trimmed) {
        // Non-zero exit with no output — tsc internal error or bad config, not fixable TS errors.
        settle(null)
        return
      }

      // Quick pre-check before the full line scan: if there are no `error TS####` lines,
      // this is a config error or internal tsc crash — not fixable TypeScript errors.
      if (!ERROR_LINE_RE.test(trimmed)) {
        settle(null)
        return
      }

      const { text, totalCount, wasCapped } = capErrors(trimmed)
      settle({ success: false, errorText: text, errorCount: totalCount, wasCapped, durationMs })
    })

    child.on('error', () => settle(null))
  })
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

interface CapResult {
  text: string
  totalCount: number  // total error count before capping — callers use this for accurate reporting
  wasCapped: boolean  // true if either cap fired and errorText is therefore incomplete
}

/**
 * Trim tsc output to at most MAX_ERRORS errors and MAX_CHARS characters.
 *
 * Order of operations:
 * 1. Slice by error count — drop everything from the (MAX_ERRORS+1)-th error onward.
 * 2. Slice by character count — hard-truncate to MAX_CHARS.
 * 3. Append exactly one trailing note: char-cap takes priority (the error-count note
 *    would be misleading if the text was also char-capped).
 *
 * The note is appended after capping so it is never itself truncated.
 */
function capErrors(raw: string): CapResult {
  // Split on both \n and \r\n so CRLF output (Windows builds, cross-platform CI)
  // doesn't leave stray \r characters in the text Claude reads.
  const lines = raw.split(/\r?\n/)

  // Identify the line index where each "error TS####" starts.
  const errorStarts: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (ERROR_LINE_RE.test(lines[i])) errorStarts.push(i)
  }

  const totalCount = errorStarts.length
  const errorCapped = totalCount > MAX_ERRORS

  // Step 1: error-count cap.
  const slicedLines = errorCapped ? lines.slice(0, errorStarts[MAX_ERRORS]) : lines
  let text = slicedLines.join('\n').trimEnd()

  // Step 2: char cap (applied before the note so the note is never cut mid-sentence).
  const charCapped = text.length > MAX_CHARS
  if (charCapped) {
    text = text.slice(0, MAX_CHARS).trimEnd()
  }

  // Step 3: exactly one trailing note.
  if (charCapped) {
    text += `\n(output capped at 2000 chars — fix what's visible first)`
  } else if (errorCapped) {
    const remaining = totalCount - MAX_ERRORS
    text += `\n(${remaining} more error${remaining !== 1 ? 's' : ''} not shown — fix the above first)`
  }

  return { text, totalCount, wasCapped: errorCapped || charCapped }
}
