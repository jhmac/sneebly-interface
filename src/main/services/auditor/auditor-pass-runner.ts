import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runStandaloneTurn, type StandaloneTurnResult } from '../standalone-turn'
import { buildExcerpt } from './auditor-file-scope'
import type { AuditableFile, AuditFinding, ModelName } from '../../../shared/types'

// ─── Finding fingerprint ──────────────────────────────────────────────────────

function fingerprint(title: string, filePath: string, startLine: number): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, '')
  return createHash('sha256')
    .update(`${normalized}|${filePath}|${startLine}`)
    .digest('hex')
    .slice(0, 16)
}

// ─── JSON extraction from LLM output ─────────────────────────────────────────

function extractJsonArray(text: string): unknown[] | null {
  // Try direct parse first
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) as unknown[] } catch { /* fall through */ }
  }

  // Try stripping markdown fences
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]!) as unknown[] } catch { /* fall through */ }
  }

  // Try finding a JSON array in the text
  const match = trimmed.match(/\[[\s\S]*\]/)
  if (match) {
    try { return JSON.parse(match[0]) as unknown[] } catch { /* fall through */ }
  }

  return null
}

// ─── Raw finding type from LLM output ────────────────────────────────────────

interface RawFinding {
  title?: string
  description?: string
  businessImpact?: string
  severity?: string
  category?: string
  filePath?: string
  startLine?: number
  endLine?: number
  suggestedFix?: string
}

function coerceSeverity(s: string | undefined): AuditFinding['severity'] {
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s
  return 'medium'
}

function coerceCategory(s: string | undefined): AuditFinding['category'] {
  const valid = ['security', 'correctness', 'convention', 'smell', 'schema', 'depsec', 'env', 'todo']
  if (s && valid.includes(s)) return s as AuditFinding['category']
  return 'correctness'
}

// ─── File chunking ────────────────────────────────────────────────────────────

const CHUNK_LINES = 800
const CHUNK_OVERLAP = 50

interface FileChunk {
  relativePath: string
  absolutePath: string
  content: string
  startLine: number // 1-indexed
}

function chunkFile(file: AuditableFile): FileChunk[] {
  let lines: string[]
  try { lines = readFileSync(file.absolutePath, 'utf-8').split('\n') } catch { return [] }

  if (lines.length <= CHUNK_LINES) {
    return [{
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      content: lines.join('\n'),
      startLine: 1,
    }]
  }

  const chunks: FileChunk[] = []
  let start = 0
  while (start < lines.length) {
    const end = Math.min(start + CHUNK_LINES, lines.length)
    chunks.push({
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      content: lines.slice(start, end).join('\n'),
      startLine: start + 1,
    })
    start = end - CHUNK_OVERLAP
    if (start >= lines.length) break
  }
  return chunks
}

// ─── Single-file prompt ───────────────────────────────────────────────────────

function buildSingleFilePrompt(file: AuditableFile, chunkNote?: string): string {
  let content: string
  try { content = readFileSync(file.absolutePath, 'utf-8') } catch { return '' }

  const lines = content.split('\n')
  const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
  const chunkSuffix = chunkNote ? `\n\n${chunkNote}` : ''

  return `relativePath: ${file.relativePath}
content (${lines.length} lines):
${numbered}${chunkSuffix}`
}

// ─── Batch prompt ─────────────────────────────────────────────────────────────

// Small files (< 5KB) are batched up to 5 per call, up to 20KB total
const BATCH_SIZE = 5
const BATCH_MAX_BYTES = 20_000

function buildBatchPrompt(files: AuditableFile[]): string {
  const parts = files.map((f, idx) => {
    let content: string
    try { content = readFileSync(f.absolutePath, 'utf-8') } catch { return `=== FILE ${idx + 1} of ${files.length} ===\nrelativePath: ${f.relativePath}\n(unreadable)` }
    const lines = content.split('\n')
    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
    return `=== FILE ${idx + 1} of ${files.length} ===\nrelativePath: ${f.relativePath}\ncontent (${lines.length} lines):\n${numbered}`
  })
  return `Files to review:\n\n${parts.join('\n\n')}`
}

// ─── Run a single LLM audit pass ─────────────────────────────────────────────

export interface PassResult {
  findings: AuditFinding[]
  tokensIn: number
  tokensOut: number
  costUsd: number
  error?: string
}

export interface PassOpts {
  projectId: string
  projectPath: string
  systemPrompt: string
  userMessage: string
  model: ModelName
  phase: AuditFinding['detectedInPhase']
  defaultCategory: AuditFinding['category']
}

const RATE_LIMIT_MARKERS = ['rate_limit', 'ratelimit', 'too many requests', '429']
const RATE_LIMIT_PAUSE_MS = 60_000

// Per-pass watchdog. Auditor passes are bounded by construction (one file, or a
// <=20KB 5-file batch, with tools locked), so anything past this is a hung claude
// subprocess. Without it, a hung call never settles, permanently occupies an
// AuditorPool concurrency slot, and the whole audit deadlocks at processedFiles=0.
// Scoped to the auditor on purpose — chat and the build/cycle agents legitimately
// run much longer, so this must NOT live in the shared runStandaloneTurn.
const PASS_TIMEOUT_MS = 5 * 60 * 1000

function isRateLimitError(error: string | undefined): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return RATE_LIMIT_MARKERS.some((m) => lower.includes(m))
}

function timedOutResult(): StandaloneTurnResult {
  return {
    events: [],
    assistantText: '',
    claudeCodeSessionId: null,
    durationMs: PASS_TIMEOUT_MS,
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    error: `timed out after ${PASS_TIMEOUT_MS / 60_000}min`,
  }
}

async function callStandaloneTurn(opts: PassOpts): Promise<StandaloneTurnResult> {
  let proc: import('node:child_process').ChildProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const turn = runStandaloneTurn({
    cwd: opts.projectPath,
    projectId: opts.projectId,
    prompt: opts.userMessage,
    model: opts.model,
    appendSystemPrompt: opts.systemPrompt,
    maxTurns: 5,
    permissionMode: 'bypassPermissions',
    // Tool lock: design generation bug confirmed that without this, Claude reads
    // CLAUDE.md and project files, contaminating the audit with project conventions.
    extraArgs: ['--tools', ''],
    // Capture the child process so the watchdog can kill it on timeout.
    onProcess: (p) => { proc = p },
  })

  const watchdog = new Promise<StandaloneTurnResult>((resolve) => {
    timer = setTimeout(() => {
      // Kill the hung claude so its pool slot frees and the underlying turn
      // promise eventually settles (on proc 'close'). SIGKILL escalation covers
      // a process wedged badly enough to ignore SIGTERM.
      try { proc?.kill('SIGTERM') } catch { /* already gone */ }
      setTimeout(() => { try { proc?.kill('SIGKILL') } catch { /* already gone */ } }, 5_000)
      resolve(timedOutResult())
    }, PASS_TIMEOUT_MS)
  })

  try {
    return await Promise.race([turn, watchdog])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// One 60s retry on rate-limit errors. Deeper backoff (3-consecutive → 5min,
// 5-consecutive → abort) is v1.1.
export async function runPass(opts: PassOpts): Promise<PassResult> {
  let result = await callStandaloneTurn(opts)

  if (isRateLimitError(result.error)) {
    await new Promise<void>((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS))
    result = await callStandaloneTurn(opts)
  }

  const findings: AuditFinding[] = []
  const raw = extractJsonArray(result.assistantText)

  if (raw) {
    for (const item of raw) {
      const r = item as RawFinding
      if (!r.title || !r.filePath || typeof r.startLine !== 'number') continue

      const endLine = typeof r.endLine === 'number' ? r.endLine : r.startLine
      const absPath = join(opts.projectPath, r.filePath)
      const excerpt = buildExcerpt(absPath, r.startLine, endLine, 3)

      const finding: AuditFinding = {
        id: `p${opts.phase}_${opts.defaultCategory}_${fingerprint(r.title, r.filePath, r.startLine)}`,
        title: (r.title ?? '').slice(0, 80),
        description: r.description ?? '',
        businessImpact: r.businessImpact,
        severity: coerceSeverity(r.severity),
        category: coerceCategory(r.category) || opts.defaultCategory,
        filePath: r.filePath,
        startLine: r.startLine,
        endLine,
        codeExcerpt: excerpt,
        suggestedFix: r.suggestedFix ?? '',
        detectedAt: Date.now(),
        detectedInPhase: opts.phase,
        resolved: false,
        resolvedAt: null,
        falsePositive: false,
        falsePositiveReason: null,
      }
      findings.push(finding)
    }
  }

  return {
    findings,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    // Preserve the underlying turn error (e.g. timeout, rate limit) for the log;
    // only fall back to the parse-failure message when the turn itself succeeded.
    error: result.error ?? (raw ? undefined : `Could not parse findings JSON (${result.assistantText.length} chars)`),
  }
}

// ─── Batched code review runner ───────────────────────────────────────────────

export async function runCodeReviewBatch(
  files: AuditableFile[],
  opts: Omit<PassOpts, 'userMessage' | 'defaultCategory'>,
): Promise<PassResult> {
  // Batch small files, run large files individually
  const small = files.filter((f) => f.sizeBytes < 5_000)
  const others = files.filter((f) => f.sizeBytes >= 5_000)

  const batches: AuditableFile[][] = []

  // Group small files into batches
  let currentBatch: AuditableFile[] = []
  let currentBytes = 0
  for (const f of small) {
    if (currentBatch.length >= BATCH_SIZE || currentBytes + f.sizeBytes > BATCH_MAX_BYTES) {
      if (currentBatch.length > 0) batches.push(currentBatch)
      currentBatch = [f]
      currentBytes = f.sizeBytes
    } else {
      currentBatch.push(f)
      currentBytes += f.sizeBytes
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch)

  // Large files get their own batch of 1 (or chunk if >50KB)
  for (const f of others) {
    batches.push([f])
  }

  const combinedErrors: string[] = []
  const combined: PassResult = { findings: [], tokensIn: 0, tokensOut: 0, costUsd: 0 }

  for (const batch of batches) {
    if (batch.length === 0) continue

    let userMessage: string
    if (batch.length === 1 && batch[0]!.sizeBytes > 50_000) {
      // Chunked file
      const chunks = chunkFile(batch[0]!)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!
        const note = chunks.length > 1
          ? `NOTE: This is chunk ${i + 1} of ${chunks.length} of this file. Line numbers are relative to the full file (starting at line ${chunk.startLine}). Do not report findings about missing imports or incomplete definitions — they may be in other chunks.`
          : undefined

        const numbered = chunk.content.split('\n')
          .map((l, idx) => `${chunk.startLine + idx}: ${l}`).join('\n')
        const chunkMsg = `relativePath: ${chunk.relativePath}\ncontent (lines ${chunk.startLine}-${chunk.startLine + chunk.content.split('\n').length - 1}):\n${numbered}${note ? '\n\n' + note : ''}`

        const r = await runPass({ ...opts, userMessage: chunkMsg, defaultCategory: 'correctness' })
        combined.findings.push(...r.findings)
        combined.tokensIn += r.tokensIn
        combined.tokensOut += r.tokensOut
        combined.costUsd += r.costUsd
        if (r.error) combinedErrors.push(r.error)
      }
      continue
    }

    userMessage = batch.length === 1
      ? buildSingleFilePrompt(batch[0]!)
      : buildBatchPrompt(batch)

    const r = await runPass({ ...opts, userMessage, defaultCategory: 'correctness' })
    combined.findings.push(...r.findings)
    combined.tokensIn += r.tokensIn
    combined.tokensOut += r.tokensOut
    combined.costUsd += r.costUsd
    if (r.error) combinedErrors.push(r.error)
  }

  if (combinedErrors.length > 0) combined.error = combinedErrors.join('; ')
  return combined
}
