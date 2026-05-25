import { readFileSync, existsSync } from 'fs'
import type { SemanticEvent, ConventionKey } from '../../shared/types'
import { readEventsForDateRange } from './event-stream'
import {
  addPending,
  listPending,
  listPromoted,
  getExtractionState,
  setExtractionState,
  isConventionRecentlyRejected,
} from './learning-store'

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000
const DOMINANCE_RATIO = 3
export const EXTRACTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

// ── Helpers ────────────────────────────────────────────────────────────────

function bashCommands(events: SemanticEvent[]): string[] {
  return events
    .filter((e) => e.kind === 'tool_call' && e.payload['toolName'] === 'Bash')
    .map((e) => {
      const args = e.payload['args'] as Record<string, unknown> | undefined
      return String(args?.['command'] ?? '')
    })
    .filter(Boolean)
}

function editedFilePaths(events: SemanticEvent[]): string[] {
  return events
    .filter(
      (e) =>
        e.kind === 'tool_call' &&
        (e.payload['toolName'] === 'Edit' || e.payload['toolName'] === 'Write')
    )
    .map((e) => {
      const args = e.payload['args'] as Record<string, unknown> | undefined
      return String(args?.['file_path'] ?? '')
    })
    .filter(Boolean)
}

function countDominant<T>(counts: Map<T, number>): { winner: T; ratio: number } | null {
  if (counts.size === 0) return null
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [first, second] = sorted
  if (!first) return null
  const ratio = second ? first[1] / second[1] : Infinity
  if (ratio < DOMINANCE_RATIO) return null
  return { winner: first[0], ratio }
}

// ── Extractors ──────────────────────────────────────────────────────────────

type ExtractorResult = { title: string; proposedChange: string }

function extractPackageManager(commands: string[]): ExtractorResult | null {
  const counts = new Map<string, number>()
  for (const cmd of commands) {
    if (/\bpnpm\b/.test(cmd)) counts.set('pnpm', (counts.get('pnpm') ?? 0) + 1)
    else if (/\byarn\b/.test(cmd)) counts.set('yarn', (counts.get('yarn') ?? 0) + 1)
    else if (/\bbun\b/.test(cmd)) counts.set('bun', (counts.get('bun') ?? 0) + 1)
    else if (/\bnpm\b/.test(cmd)) counts.set('npm', (counts.get('npm') ?? 0) + 1)
  }
  const dominant = countDominant(counts)
  if (!dominant) return null
  const pm = dominant.winner
  return {
    title: `Package manager: ${pm}`,
    proposedChange: `This project uses ${pm}. Always run scripts and install packages with \`${pm}\`.`,
  }
}

const TEST_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bvitest\b/, label: 'vitest' },
  { re: /\bpnpm\s+(?:run\s+)?test\b/, label: 'pnpm test' },
  { re: /\byarn\s+(?:run\s+)?test\b/, label: 'yarn test' },
  { re: /\bbun\s+(?:run\s+)?test\b/, label: 'bun test' },
  { re: /\bnpm\s+(?:run\s+)?test\b/, label: 'npm test' },
  { re: /\bpytest\b/, label: 'pytest' },
  { re: /\bgo\s+test\b/, label: 'go test' },
  { re: /\bcargo\s+test\b/, label: 'cargo test' },
]

function extractTestCommand(commands: string[]): ExtractorResult | null {
  const counts = new Map<string, number>()
  for (const cmd of commands) {
    for (const { re, label } of TEST_PATTERNS) {
      if (re.test(cmd)) {
        counts.set(label, (counts.get(label) ?? 0) + 1)
        break
      }
    }
  }
  const dominant = countDominant(counts)
  if (!dominant) return null
  const cmd = dominant.winner
  return {
    title: `Test command: ${cmd}`,
    proposedChange: `Run tests with \`${cmd}\`. Use this command to verify changes before finishing.`,
  }
}

function detectIndentStyle(filePath: string): { tabs: number; two: number; four: number } {
  if (!existsSync(filePath)) return { tabs: 0, two: 0, four: 0 }
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').slice(0, 60)
    let tabs = 0; let two = 0; let four = 0
    for (const line of lines) {
      if (/^\t/.test(line)) { tabs++; continue }
      const m = line.match(/^( +)/)
      if (!m) continue
      if (m[1].length % 4 === 0) four++
      else if (m[1].length % 2 === 0) two++
    }
    return { tabs, two, four }
  } catch {
    return { tabs: 0, two: 0, four: 0 }
  }
}

function extractIndentStyle(filePaths: string[]): ExtractorResult | null {
  // Deduplicate then sample up to 20 source files (skip node_modules, lock files, large binaries)
  const sample = [...new Set(filePaths)]
    .filter((p) => !p.includes('node_modules') && !p.endsWith('.lock') && /\.(ts|tsx|js|jsx|py|go|rs|rb|java|cs)$/.test(p))
    .slice(0, 20)
  if (sample.length < 3) return null

  let tabs = 0; let two = 0; let four = 0
  for (const f of sample) {
    const r = detectIndentStyle(f)
    tabs += r.tabs; two += r.two; four += r.four
  }
  const counts = new Map<string, number>([['tabs', tabs], ['2-space', two], ['4-space', four]])
  const dominant = countDominant(counts)
  if (!dominant) return null
  const style = dominant.winner
  const styleLabel = style === 'tabs' ? 'tabs' : style === '2-space' ? '2 spaces' : '4 spaces'
  return {
    title: `Indent style: ${styleLabel}`,
    proposedChange: `This project uses ${styleLabel} for indentation. Match this style in all edits.`,
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export function runConventionExtraction(projectPath: string, projectId: string): void {
  const state = getExtractionState(projectPath)
  if (Date.now() - state.lastRunAt < EXTRACTION_COOLDOWN_MS) return

  const fromTs = Date.now() - LOOKBACK_MS
  const events = readEventsForDateRange(projectPath, fromTs, Date.now())
  if (events.length === 0) return

  const commands = bashCommands(events)
  const filePaths = editedFilePaths(events)
  const promoted = listPromoted(projectPath)
  const pending = listPending(projectPath)

  const candidates: Array<{ key: ConventionKey; title: string; proposedChange: string }> = []

  const pmResult = extractPackageManager(commands)
  if (pmResult) candidates.push({ key: 'package-manager', ...pmResult })

  const testResult = extractTestCommand(commands)
  if (testResult) candidates.push({ key: 'test-command', ...testResult })

  const indentResult = extractIndentStyle(filePaths)
  if (indentResult) candidates.push({ key: 'indent-style', ...indentResult })

  const today = new Date().toISOString().slice(0, 10)

  for (const candidate of candidates) {
    if (isConventionRecentlyRejected(projectPath, candidate.key)) continue

    const existing = promoted.find(
      (p) => p.targetScope === 'conventions-md' && p.conventionKey === candidate.key
    )

    if (existing) {
      if (existing.proposedChange === candidate.proposedChange) continue
      addPending(projectPath, {
        sourceReflectionDate: today,
        title: candidate.title,
        rationale: 'Observed pattern has changed from the currently active convention.',
        proposedChange: candidate.proposedChange,
        frictionCount: 0,
        targetScope: 'conventions-md',
        conventionKey: candidate.key,
        lastObservedAt: Date.now(),
        supersedes: existing.id,
      })
    } else {
      const alreadyPending = pending.some(
        (p) => p.targetScope === 'conventions-md' && p.conventionKey === candidate.key
      )
      if (!alreadyPending) {
        addPending(projectPath, {
          sourceReflectionDate: today,
          title: candidate.title,
          rationale: `Observed consistently across ${events.length} recorded events.`,
          proposedChange: candidate.proposedChange,
          frictionCount: 0,
          targetScope: 'conventions-md',
          conventionKey: candidate.key,
          lastObservedAt: Date.now(),
        })
      }
    }
  }

  setExtractionState(projectPath, { ...state, lastRunAt: Date.now() })
}

export function scheduleConventionExtraction(
  projectPath: string,
  projectId: string,
  delayMs = 10_000
): void {
  setTimeout(() => {
    try {
      runConventionExtraction(projectPath, projectId)
    } catch (err) {
      console.error('[convention-extractor] extraction failed:', err)
    }
  }, delayMs)
}
