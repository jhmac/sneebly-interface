import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { getSkillPrompt } from './skills-loader'
import { listProjects } from './project-registry'
import { loadPhasePlan, getMilestoneById } from './phase-tracker'
import { readEventsForDateRange, appendEvent } from './event-stream'
import type {
  AgentEvent,
  AgentContentToolUse,
  ModelName,
  ReviewOutput,
  ReviewAction,
  SemanticEventKind,
} from '../../shared/types'

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
  // Prefer the per-milestone auto-commit (subject "[<id>] ...").
  try {
    const { stdout: hash } = await execFileAsync('git', ['log', '--grep', `\\[${milestoneId}\\]`, '-n', '1', '--format=%H'], opts)
    if (hash.trim()) {
      const { stdout } = await execFileAsync('git', ['show', hash.trim()], opts)
      return truncateDiff(stdout)
    }
  } catch { /* fall through */ }
  // Fallback: current uncommitted working diff.
  try {
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], opts)
    return stdout.trim() ? truncateDiff(stdout) : '(no diff found for this milestone)'
  } catch {
    return '(could not read diff)'
  }
}

function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_TRUNCATE) return diff
  return diff.slice(0, DIFF_TRUNCATE) + `\n…(diff truncated at ${DIFF_TRUNCATE} chars)`
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
  emitEvent(project.path, projectId, 'review_agent_started', { milestoneId, model })

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
        emitEvent(project.path, projectId, 'review_agent_completed', { milestoneId, verdict: 'broken', confidence: 'low', recommendedActionType: 'escalate', durationMs })
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
      })
      cb.onDone(turnId, output)
    })
    .catch((err: unknown) => {
      activeTurns.delete(turnId)
      cb.onDone(turnId, undefined, err instanceof Error ? err.message : String(err))
    })

  return turnId
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
