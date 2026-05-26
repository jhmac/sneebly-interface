import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { runStandaloneTurn } from './standalone-turn'
import { getSkillPrompt } from './skills-loader'
import { listProjects } from './project-registry'
import { readEventsForDateRange, appendEvent } from './event-stream'
import type {
  AskSneeblyStartInput,
  AgentEvent,
  AgentContentToolUse,
  ModelName,
  SemanticEventKind,
} from '../../shared/types'

const execFileAsync = promisify(execFile)
const DOC_TRUNCATE = 8000
const DIFF_TRUNCATE = 3000
const CANCEL_GRACE_MS = 2000

export interface AskSneeblyCallbacks {
  onChunk: (turnId: string, chunk: string) => void
  onThinking: (turnId: string, status: string) => void
  onDone: (turnId: string, error?: string) => void
}

interface ActiveTurn {
  proc?: ChildProcess
  cancelled: boolean
  answer: string
  startedAt: number
  projectId: string
  projectPath: string
  conversationId: string
  question: string
}

const activeTurns = new Map<string, ActiveTurn>()

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

async function getDiff(projectPath: string): Promise<string | null> {
  if (!existsSync(join(projectPath, '.git'))) return null
  try {
    const { stdout: stat } = await execFileAsync('git', ['diff', '--stat'], {
      cwd: projectPath, timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    })
    const { stdout: full } = await execFileAsync('git', ['diff'], {
      cwd: projectPath, timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
    })
    const body = full.length > DIFF_TRUNCATE ? full.slice(0, DIFF_TRUNCATE) + '\n…(truncated)' : full
    return `${stat}\n${body}`.trim() || null
  } catch {
    return null
  }
}

function recentEvents(projectPath: string): string | null {
  try {
    const now = Date.now()
    const events = readEventsForDateRange(projectPath, now - 24 * 60 * 60 * 1000, now)
    if (events.length === 0) return null
    return events
      .slice(-20)
      .map((e) => `- [${new Date(e.ts).toLocaleTimeString()}] ${e.kind}`)
      .join('\n')
  } catch {
    return null
  }
}

async function buildContextBundle(
  opts: AskSneeblyStartInput,
  project: { name: string; path: string }
): Promise<string> {
  const parts: string[] = [`Project: ${project.name}\nPath: ${project.path}`]

  const goals = readDoc(project.path, 'GOALS.md')
  if (goals) parts.push(`--- GOALS.md ---\n${goals}`)

  const claude = readDoc(project.path, 'CLAUDE.md')
  if (claude) parts.push(`--- CLAUDE.md ---\n${claude}`)

  if (opts.includeDiff) {
    const diff = await getDiff(project.path)
    parts.push(`--- Current uncommitted diff ---\n${diff ?? '(no uncommitted changes)'}`)
  }

  if (opts.includeEvents) {
    const ev = recentEvents(project.path)
    parts.push(`--- Recent activity (last 20) ---\n${ev ?? '(no recent activity)'}`)
  }

  parts.push(`--- User's question ---\n${opts.question}`)
  return parts.join('\n\n')
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

function emitEvent(turn: ActiveTurn, kind: SemanticEventKind, payload: Record<string, unknown>): void {
  try {
    appendEvent(turn.projectPath, turn.conversationId, {
      id: randomUUID(),
      sessionId: turn.conversationId,
      projectId: turn.projectId,
      ts: Date.now(),
      kind,
      source: 'chat',
      payload,
    })
  } catch {
    // Event recording is best-effort; never block Q&A on it.
  }
}

export function startAskSneeblyTurn(
  opts: AskSneeblyStartInput,
  model: ModelName,
  cb: AskSneeblyCallbacks
): string {
  const turnId = randomUUID()
  const project = listProjects().find((p) => p.id === opts.projectId)
  if (!project) {
    cb.onDone(turnId, 'Project not found')
    return turnId
  }

  const turn: ActiveTurn = {
    cancelled: false,
    answer: '',
    startedAt: Date.now(),
    projectId: opts.projectId,
    projectPath: project.path,
    conversationId: opts.conversationId,
    question: opts.question,
  }
  activeTurns.set(turnId, turn)

  emitEvent(turn, 'ask_sneebly_question_asked', {
    question: opts.question,
    includeDiff: !!opts.includeDiff,
    includeEvents: !!opts.includeEvents,
  })

  const systemPrompt = getSkillPrompt('ask-sneebly') ?? undefined

  buildContextBundle(opts, project)
    .then((bundle) =>
      runStandaloneTurn({
        cwd: project.path,
        projectId: opts.projectId,
        prompt: bundle,
        model,
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Grep', 'Glob'],
        appendSystemPrompt: systemPrompt,
        onProcess: (proc) => { turn.proc = proc },
        onEvent: (event: AgentEvent) => {
          if (turn.cancelled || event.type !== 'assistant') return
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              turn.answer += block.text
              cb.onChunk(turnId, block.text)
            } else if (block.type === 'tool_use') {
              cb.onThinking(turnId, toolStatus(block))
            }
          }
        },
      })
    )
    .then((result) => {
      activeTurns.delete(turnId)
      const durationMs = Date.now() - turn.startedAt
      if (turn.cancelled) {
        emitEvent(turn, 'ask_sneebly_question_cancelled', { question: turn.question, durationMs })
        cb.onDone(turnId, 'cancelled')
        return
      }
      if (result.error) {
        cb.onDone(turnId, result.error)
        return
      }
      emitEvent(turn, 'ask_sneebly_question_answered', {
        question: turn.question,
        answerPreview: turn.answer.slice(0, 200),
        durationMs,
      })
      cb.onDone(turnId)
    })
    .catch((err: unknown) => {
      activeTurns.delete(turnId)
      cb.onDone(turnId, err instanceof Error ? err.message : String(err))
    })

  return turnId
}

export function cancelAskSneeblyTurn(turnId: string): void {
  const turn = activeTurns.get(turnId)
  if (!turn || turn.cancelled) return
  turn.cancelled = true
  const proc = turn.proc
  if (proc && proc.pid != null) {
    try { proc.kill('SIGTERM') } catch { /* already gone */ }
    setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* already gone */ } }, CANCEL_GRACE_MS)
  }
}
