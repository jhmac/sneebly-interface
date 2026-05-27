import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import Store from 'electron-store'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { getSkillPrompt } from './skills-loader'
import { listProjects } from './project-registry'
import { loadPhasePlan, getMilestoneById } from './phase-tracker'
import { readEventsForDateRange, appendEvent } from './event-stream'
import { sendToProjectWindows } from './window-registry'
import { turnEmitter } from './agent-session'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { agentBus } from './agent-bus'
import type {
  AgentEvent,
  AgentContentToolUse,
  AppSettings,
  ModelName,
  ReviewOutput,
  ReviewAction,
  ReviewFixState,
  SemanticEventKind,
} from '../../shared/types'

const settingsStore = new Store()

const execFileAsync = promisify(execFile)
const DOC_TRUNCATE = 6000
const DIFF_TRUNCATE = 12_000
const REVIEW_SESSION = 'review-agent'

export interface ReviewCallbacks {
  onThinking: (turnId: string, status: string) => void
  onDone: (turnId: string, result?: ReviewOutput, error?: string) => void
}

interface ActiveTurn {
  proc?: ChildProcess
  cancelled: boolean
}

const activeTurns = new Map<string, ActiveTurn>()
// In-session pattern memory: last few reviews per project.
const priorReviews = new Map<string, ReviewOutput[]>()
const MAX_PRIOR = 3

function readDoc(projectPath: string, name: string): string | null {
  const p = join(projectPath, name)
  if (!existsSync(p)) return null
  try {
    const c = readFileSync(p, 'utf-8')
    return c.length > DOC_TRUNCATE ? c.slice(0, DOC_TRUNCATE) + '\n…(truncated)' : c
  } catch {
    return null
  }
}

async function getMilestoneDiff(projectPath: string, milestoneId: string): Promise<string> {
  if (!existsSync(join(projectPath, '.git'))) return '(not a git repo)'
  const opts = { cwd: projectPath, encoding: 'utf-8' as const, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }
  const run = (args: string[]) => execFileAsync('git', args, opts).then((r) => r.stdout)
  // Prefer the per-milestone auto-commit (subject "[<id>] ...").
  try {
    const hash = (await run(['log', '--grep', `\\[${milestoneId}\\]`, '-n', '1', '--format=%H'])).trim()
    if (hash) {
      const [stat, patch] = await Promise.all([
        run(['show', '--stat', '--format=', hash]),
        run(['show', '--format=', hash]),
      ])
      return combineDiff(stat, patch)
    }
  } catch { /* fall through */ }
  // Fallback: current uncommitted working diff (no per-milestone commit). The stat
  // summary lets the reviewer see every changed file even when the patch is truncated,
  // then read the real files to verify.
  try {
    const [stat, patch] = await Promise.all([run(['diff', '--stat', 'HEAD']), run(['diff', 'HEAD'])])
    if (!patch.trim()) return '(no diff found for this milestone)'
    return combineDiff(stat, patch)
  } catch {
    return '(could not read diff)'
  }
}

function combineDiff(stat: string, patch: string): string {
  const s = stat.trim()
  const header = s ? `Files changed:\n${s}\n\n` : ''
  return header + truncateDiff(patch)
}

function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_TRUNCATE) return diff
  return diff.slice(0, DIFF_TRUNCATE) + `\n…(patch truncated at ${DIFF_TRUNCATE} chars — read the listed files to verify)`
}

function recentEvents(projectPath: string): string {
  try {
    const now = Date.now()
    const events = readEventsForDateRange(projectPath, now - 24 * 60 * 60 * 1000, now)
    if (events.length === 0) return '(no recent activity)'
    return events
      .slice(-10)
      .map((e) => `${e.kind}: ${JSON.stringify(e.payload).slice(0, 200)}`)
      .join('\n')
  } catch {
    return '(no recent activity)'
  }
}

function toolStatus(block: AgentContentToolUse): string {
  const input = (block.input ?? {}) as Record<string, unknown>
  const fp = input['file_path'] ?? input['path']
  switch (block.name) {
    case 'Read': return `Reading ${fp ? basename(String(fp)) : 'a file'}…`
    case 'Grep': return `Searching for "${String(input['pattern'] ?? '')}"…`
    case 'Glob': return 'Looking for files…'
    default: return `${block.name}…`
  }
}

function emitEvent(projectPath: string, projectId: string, kind: SemanticEventKind, payload: Record<string, unknown>): void {
  try {
    appendEvent(projectPath, REVIEW_SESSION, {
      id: randomUUID(),
      sessionId: REVIEW_SESSION,
      projectId,
      ts: Date.now(),
      kind,
      source: 'chat',
      payload,
    })
  } catch {
    // best-effort
  }
}

// Defensively coerce a parsed JSON object into a well-formed ReviewOutput so the UI
// never crashes on a malformed-but-parseable response.
function normalize(raw: unknown): ReviewOutput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r['verdict'] !== 'complete' && r['verdict'] !== 'partial' && r['verdict'] !== 'broken') return null
  const action = (r['recommendedAction'] ?? {}) as Record<string, unknown>
  const actionType = action['type']
  const recommendedAction: ReviewAction =
    actionType === 'refine'
      ? { type: 'refine', reason: String(action['reason'] ?? ''), kickoffPrompt: String(action['kickoffPrompt'] ?? '') }
      : actionType === 'rollback'
        ? { type: 'rollback', reason: String(action['reason'] ?? ''), rollbackTarget: String(action['rollbackTarget'] ?? '') }
        : actionType === 'escalate'
          ? { type: 'escalate', reason: String(action['reason'] ?? ''), questionsForUser: Array.isArray(action['questionsForUser']) ? (action['questionsForUser'] as string[]) : [] }
          : { type: 'accept', reason: String(action['reason'] ?? '') }

  return {
    verdict: r['verdict'],
    confidence: (r['confidence'] === 'high' || r['confidence'] === 'medium' || r['confidence'] === 'low') ? r['confidence'] : 'low',
    eightLensFindings: Array.isArray(r['eightLensFindings']) ? (r['eightLensFindings'] as ReviewOutput['eightLensFindings']) : [],
    specMatch: Array.isArray(r['specMatch']) ? (r['specMatch'] as ReviewOutput['specMatch']) : [],
    recommendedAction,
    nonBlockingObservations: Array.isArray(r['nonBlockingObservations']) ? (r['nonBlockingObservations'] as string[]) : [],
    uncertaintyFlags: Array.isArray(r['uncertaintyFlags']) ? (r['uncertaintyFlags'] as string[]) : [],
  }
}

export function startReview(
  projectId: string,
  milestoneId: string,
  model: ModelName,
  autoFired: boolean,
  cb: ReviewCallbacks
): string {
  const turnId = randomUUID()
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) {
    cb.onDone(turnId, undefined, 'Project not found')
    return turnId
  }
  const plan = loadPhasePlan(project.path)
  const milestone = plan ? getMilestoneById(plan, milestoneId) : null
  if (!milestone) {
    cb.onDone(turnId, undefined, `Milestone ${milestoneId} not found`)
    return turnId
  }

  const turn: ActiveTurn = { cancelled: false }
  activeTurns.set(turnId, turn)
  // Surface the chip immediately, before the (async) bundle build + first tool call.
  cb.onThinking(turnId, 'Starting review…')
  emitEvent(project.path, projectId, 'review_agent_started', { milestoneId, model, autoFired })

  const systemPrompt = getSkillPrompt('review-agent') ?? undefined
  const startedAt = Date.now()

  buildBundle(project, milestoneId, milestone)
    .then((bundle) =>
      runStandaloneTurn({
        cwd: project.path,
        projectId,
        prompt: bundle,
        model,
        permissionMode: 'default',
        allowedTools: ['Read', 'Grep', 'Glob'],
        appendSystemPrompt: systemPrompt,
        onProcess: (proc) => { turn.proc = proc },
        onEvent: (event: AgentEvent) => {
          if (turn.cancelled || event.type !== 'assistant') return
          for (const block of event.message.content) {
            if (block.type === 'tool_use') cb.onThinking(turnId, toolStatus(block))
          }
        },
      })
    )
    .then((result) => {
      activeTurns.delete(turnId)
      if (turn.cancelled) {
        cb.onDone(turnId, undefined, 'cancelled')
        return
      }
      const parsed = extractJson<unknown>(result.assistantText)
      const output = parsed ? normalize(parsed) : null
      const durationMs = Date.now() - startedAt

      if (!output) {
        const broken: ReviewOutput = {
          verdict: 'broken',
          confidence: 'low',
          eightLensFindings: [],
          specMatch: [],
          recommendedAction: { type: 'escalate', reason: 'Could not parse a structured verdict from the review.', questionsForUser: [] },
          nonBlockingObservations: [],
          uncertaintyFlags: ['JSON parsing failed'],
          rawText: result.assistantText.slice(0, 4000),
        }
        emitEvent(project.path, projectId, 'review_agent_completed', { milestoneId, verdict: 'broken', confidence: 'low', recommendedActionType: 'escalate', durationMs, autoFired })
        cb.onDone(turnId, broken)
        return
      }

      const list = priorReviews.get(projectId) ?? []
      priorReviews.set(projectId, [...list, output].slice(-MAX_PRIOR))
      emitEvent(project.path, projectId, 'review_agent_completed', {
        milestoneId,
        verdict: output.verdict,
        confidence: output.confidence,
        recommendedActionType: output.recommendedAction.type,
        durationMs,
        autoFired,
      })
      cb.onDone(turnId, output)
    })
    .catch((err: unknown) => {
      activeTurns.delete(turnId)
      cb.onDone(turnId, undefined, err instanceof Error ? err.message : String(err))
    })

  return turnId
}

// Single entry point used by the IPC handler (manual) and the auto-fire call sites.
// Self-gates on settings, resolves the model, and pushes THINKING/DONE events
// (with milestoneId so the renderer can key its per-milestone chip). Returns the
// turnId, or null if the review was skipped (disabled / auto-fire off).
export function fireReview(
  projectId: string,
  milestoneId: string,
  autoFired: boolean,
  opts?: { bypassAutoFireGate?: boolean },
): string | null {
  const settings = settingsStore.get('appSettings', {}) as Partial<AppSettings>
  if (settings.reviewAgentEnabled === false) return null
  // The auto-fire gate only governs reviews fired automatically after markMilestoneComplete.
  // Fix-cycle re-reviews are user-initiated (the user pasted the kickoff) and pass the bypass.
  if (autoFired && !opts?.bypassAutoFireGate && settings.reviewAgentAutoFire !== true) return null
  const model = (settings.reviewAgentModel as ModelName | undefined) ?? 'claude-opus-4-7'
  return startReview(projectId, milestoneId, model, autoFired, {
    onThinking: (turnId, status) =>
      sendToProjectWindows(projectId, IPC_CHANNELS.REVIEW_AGENT_THINKING, turnId, milestoneId, status),
    onDone: (turnId, result, error) => {
      sendToProjectWindows(projectId, IPC_CHANNELS.REVIEW_AGENT_DONE, turnId, milestoneId, result, error)
      void handleReviewDoneForFix(projectId, milestoneId, turnId, result, error)
    },
  })
}

async function buildBundle(
  project: { name: string; path: string },
  milestoneId: string,
  milestone: { text: string; testChecklist: string[]; specPath: string | null; kickoffPrompt: string }
): Promise<string> {
  const spec = milestone.specPath ? readDoc(project.path, milestone.specPath) : null
  const diff = await getMilestoneDiff(project.path, milestoneId)
  const claudeMd = readDoc(project.path, 'CLAUDE.md') ?? '(none)'
  const goalsMd = readDoc(project.path, 'GOALS.md') ?? '(none)'
  const events = recentEvents(project.path)
  const prior = priorReviews.get(project.path) ?? []
  const priorText = prior.length
    ? prior.map((r) => `${r.verdict} (${r.confidence}): ${r.recommendedAction.reason}`).join('\n')
    : '(none yet this session)'

  return [
    `Project: ${project.name}`,
    `Milestone: ${milestoneId}`,
    ``,
    `--- Milestone definition (from phase-plan.json) ---`,
    milestone.text,
    ``,
    `Test checklist:`,
    milestone.testChecklist.map((t, i) => `  ${i + 1}. ${t}`).join('\n') || '  (none)',
    ``,
    `--- Spec (if present) ---`,
    spec ?? '(no spec file found — derive criteria from the milestone text and checklist)',
    ``,
    `--- Kickoff prompt that triggered the build ---`,
    milestone.kickoffPrompt || '(no kickoff prompt recorded)',
    ``,
    `--- Diff for this milestone ---`,
    diff,
    ``,
    `--- Recent activity (last 10 events) ---`,
    events,
    ``,
    `--- Project conventions (CLAUDE.md, truncated) ---`,
    claudeMd,
    ``,
    `--- GOALS.md (truncated) ---`,
    goalsMd,
    ``,
    `--- Recent prior reviews (for pattern memory) ---`,
    priorText,
    ``,
    `Audit this milestone against its spec and respond with the single JSON object per your output contract.`,
  ].join('\n')
}

export function recordReviewAction(projectId: string, milestoneId: string, action: string): void {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) return
  emitEvent(project.path, projectId, 'review_agent_action_taken', { milestoneId, action })
}

export function cancelReview(turnId: string): void {
  const turn = activeTurns.get(turnId)
  if (!turn || turn.cancelled) return
  turn.cancelled = true
  const proc = turn.proc
  if (proc && proc.pid != null) {
    try { proc.kill('SIGTERM') } catch { /* gone */ }
    setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* gone */ } }, 2000)
  }
}

// ── Fix-tracking: close the Paste-into-chat → fix → verify loop ───────────────
//
// When the user pastes a review's kickoff prompt into chat, we record the project's
// HEAD and watch for the next chat/phase-runner turn to land commits. New commits
// trigger an automatic re-review; if it returns 'complete', the loop closed (Fixed),
// otherwise the chip reverts to the updated verdict. State lives here in main, not the
// renderer, because the signals (turnEmitter, git log) are main-process.

export interface PendingFix {
  startedAt: number
  fromReviewId: string
  sinceCommit: string
  // True once a re-review has been fired for this cycle — prevents a second turn-end
  // from stacking duplicate re-reviews before the first resolves.
  verifying: boolean
  // Backstop timer that reverts the chip if no fix commit ever lands. Cleared when the
  // cycle resolves, is superseded, or transitions to verifying.
  expiryTimer?: ReturnType<typeof setTimeout>
}

const FIX_TIMEOUT_MS = 30 * 60 * 1000
const pendingFixByMilestone = new Map<string, PendingFix>()

function fixKey(projectId: string, milestoneId: string): string {
  return `${projectId}:${milestoneId}`
}

// Cancel the backstop timer (if any) and drop the entry. Single removal path so a
// stale timer can never fire against a superseded or already-resolved cycle.
function removePendingFix(key: string): void {
  const entry = pendingFixByMilestone.get(key)
  if (entry?.expiryTimer) clearTimeout(entry.expiryTimer)
  pendingFixByMilestone.delete(key)
}

// Schedule the "paste but no commit" backstop. unref'd so it never keeps the process
// (or a test run) alive; the startedAt guard ignores a superseded cycle.
function scheduleFixExpiry(
  projectId: string,
  milestoneId: string,
  startedAt: number,
  deps: FixTrackingDeps,
): ReturnType<typeof setTimeout> {
  const t = setTimeout(() => {
    const key = fixKey(projectId, milestoneId)
    const entry = pendingFixByMilestone.get(key)
    if (!entry || entry.startedAt !== startedAt) return
    pendingFixByMilestone.delete(key)
    deps.emitFixState(projectId, milestoneId, 'cleared')
  }, FIX_TIMEOUT_MS)
  if (typeof t.unref === 'function') t.unref()
  return t
}

// ── Pure helpers (unit-tested directly) ──

export function parseCommitHashes(gitLogStdout: string): string[] {
  const t = gitLogStdout.trim()
  return t ? t.split('\n').filter(Boolean) : []
}

export function isFixExpired(startedAt: number, now: number): boolean {
  return startedAt < now - FIX_TIMEOUT_MS
}

// The loop closed only when the re-review came back clean. Any other outcome (still
// partial/broken, or an error) reverts the chip to the cached verdict.
export function resolveFixOutcome(
  result: ReviewOutput | undefined,
  error: string | undefined,
): 'fixed' | 'cleared' {
  return !error && result?.verdict === 'complete' ? 'fixed' : 'cleared'
}

// IO seam so the orchestration is testable without git / electron / a live review.
export interface FixTrackingDeps {
  listProjects: typeof listProjects
  emitFixState: (projectId: string, milestoneId: string, state: ReviewFixState) => void
  gitRevParseHead: (cwd: string) => Promise<string>
  gitLogSince: (cwd: string, sinceCommit: string) => Promise<string[]>
  fireFixReview: (projectId: string, milestoneId: string) => string | null
  now: () => number
}

const defaultFixDeps: FixTrackingDeps = {
  listProjects,
  emitFixState: (projectId, milestoneId, state) =>
    sendToProjectWindows(projectId, IPC_CHANNELS.REVIEW_AGENT_FIX_STATE_CHANGED, milestoneId, state),
  gitRevParseHead: async (cwd) =>
    (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 })).stdout.trim(),
  gitLogSince: async (cwd, sinceCommit) =>
    parseCommitHashes(
      (await execFileAsync('git', ['log', `${sinceCommit}..HEAD`, '--format=%H'], { cwd, timeout: 5000 })).stdout,
    ),
  fireFixReview: (projectId, milestoneId) => fireReview(projectId, milestoneId, true, { bypassAutoFireGate: true }),
  now: () => Date.now(),
}

// Called when the user pastes a kickoff prompt. Records HEAD and shows the "Fixing…" chip.
export async function beginFixTracking(
  projectId: string,
  milestoneId: string,
  reviewId: string,
  deps: FixTrackingDeps = defaultFixDeps,
): Promise<void> {
  const project = deps.listProjects().find((p) => p.id === projectId)
  if (!project) return
  let sinceCommit: string
  try {
    sinceCommit = await deps.gitRevParseHead(project.path)
  } catch {
    return // not a git repo / git unavailable — can't detect the fix commit
  }
  const key = fixKey(projectId, milestoneId)
  removePendingFix(key) // supersede any prior cycle on this milestone (cancels its timer)
  const startedAt = deps.now()
  const entry: PendingFix = { startedAt, fromReviewId: reviewId, sinceCommit, verifying: false }
  entry.expiryTimer = scheduleFixExpiry(projectId, milestoneId, startedAt, deps)
  pendingFixByMilestone.set(key, entry)
  deps.emitFixState(projectId, milestoneId, 'fixing')
}

// Called on every chat/phase-runner turn-end. For each tracked fix in this project:
// expire stale entries, and on new commits fire one re-review (showing "Verifying…").
export async function handleTurnEndForFix(
  projectId: string,
  deps: FixTrackingDeps = defaultFixDeps,
): Promise<void> {
  const prefix = `${projectId}:`
  const matching = [...pendingFixByMilestone.entries()].filter(([key]) => key.startsWith(prefix))
  if (matching.length === 0) return

  const now = deps.now()
  const project = deps.listProjects().find((p) => p.id === projectId)

  for (const [key, pendingFix] of matching) {
    const milestoneId = key.slice(projectId.length + 1)

    if (isFixExpired(pendingFix.startedAt, now)) {
      removePendingFix(key)
      deps.emitFixState(projectId, milestoneId, 'cleared')
      continue
    }
    if (pendingFix.verifying) continue // a re-review is already running for this cycle
    if (!project) continue

    let commits: string[]
    try {
      commits = await deps.gitLogSince(project.path, pendingFix.sinceCommit)
    } catch {
      continue // git failed — leave the entry, try again on the next turn
    }
    if (commits.length === 0) continue // no fix commit yet

    // A commit landed: verification supersedes the backstop timer (the re-review's
    // completion now owns the outcome).
    if (pendingFix.expiryTimer) { clearTimeout(pendingFix.expiryTimer); pendingFix.expiryTimer = undefined }
    pendingFix.verifying = true
    const turnId = deps.fireFixReview(projectId, milestoneId)
    if (turnId) {
      deps.emitFixState(projectId, milestoneId, 'verifying')
    } else {
      // Review Agent disabled mid-cycle — can't verify; stop tracking.
      removePendingFix(key)
      deps.emitFixState(projectId, milestoneId, 'cleared')
    }
  }
}

// Called from every review's onDone. No-op unless a fix cycle is tracked for this
// milestone; otherwise transitions to Fixed (and logs the event) or reverts the chip.
export async function handleReviewDoneForFix(
  projectId: string,
  milestoneId: string,
  turnId: string,
  result: ReviewOutput | undefined,
  error: string | undefined,
  deps: FixTrackingDeps = defaultFixDeps,
): Promise<void> {
  // Signal the Decider review bridge — fire for every review completion.
  agentBus.emit('review:done', projectId, milestoneId)

  const key = fixKey(projectId, milestoneId)
  const pendingFix = pendingFixByMilestone.get(key)
  if (!pendingFix) return // not a fix cycle — a normal first-time / auto-fire review
  removePendingFix(key)

  const outcome = resolveFixOutcome(result, error)
  deps.emitFixState(projectId, milestoneId, outcome)
  if (outcome !== 'fixed') return

  const project = deps.listProjects().find((p) => p.id === projectId)
  if (!project) return
  let fixCommitsCount = 0
  try {
    fixCommitsCount = (await deps.gitLogSince(project.path, pendingFix.sinceCommit)).length
  } catch {
    // best-effort count
  }
  emitEvent(project.path, projectId, 'review_agent_fix_addressed', {
    milestoneId,
    previousReviewId: pendingFix.fromReviewId,
    newReviewId: turnId,
    fixCommitsCount,
  })
}

// Test-only: inspect / reset in-memory fix state between cases.
export function __getPendingFix(projectId: string, milestoneId: string): PendingFix | undefined {
  return pendingFixByMilestone.get(fixKey(projectId, milestoneId))
}
export function __resetFixTracking(): void {
  for (const entry of pendingFixByMilestone.values()) {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer)
  }
  pendingFixByMilestone.clear()
}

// Watch chat / phase-runner turns. A re-review uses runStandaloneTurn (not startTurn),
// so it never emits 'turn-end' — no risk of a verify triggering another verify.
turnEmitter.on('turn-end', (data: { projectId: string }) => {
  void handleTurnEndForFix(data.projectId)
})
