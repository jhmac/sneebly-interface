import { type ChildProcess } from 'node:child_process'
import type { AgentEvent } from '../../shared/types'
import { runStandaloneTurn } from './standalone-turn'
import { appendEvent, agentEventToSemanticEvents } from './event-stream'

// Keyed by sneeblySessionId for abort support
const activeProcesses = new Map<string, ChildProcess>()

// Tracks sessions killed via abortSession — used to distinguish stop vs error
const abortedSessions = new Set<string>()

// Which projectIds have an active chat turn — read by the daemon's soft lock
const activeChatProjectIds = new Set<string>()

export interface TurnOpts {
  cwd: string
  projectId: string
  sneeblySessionId: string
  claudeCodeSessionId?: string | null
  prompt: string
  model: string
  appendSystemPrompt?: string
  recordEvents?: boolean
}

export function startTurn(
  opts: TurnOpts,
  onEvent: (event: AgentEvent) => void,
  onDone: (claudeSessionId: string | null, error?: string) => void
): void {
  activeChatProjectIds.add(opts.projectId)
  let sawTurnEnd = false

  runStandaloneTurn({
    cwd: opts.cwd,
    projectId: opts.projectId,
    prompt: opts.prompt,
    model: opts.model as 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5',
    permissionMode: 'bypassPermissions',
    resumeSessionId: opts.claudeCodeSessionId,
    appendSystemPrompt: opts.appendSystemPrompt,
    onProcess: (proc) => {
      activeProcesses.set(opts.sneeblySessionId, proc)
    },
    onEvent: (event) => {
      const richEvent = { ...event, source: 'chat' } as AgentEvent
      onEvent(richEvent)

      if (opts.recordEvents) {
        const semantic = agentEventToSemanticEvents(
          richEvent,
          opts.sneeblySessionId,
          opts.projectId,
          'chat'
        )
        for (const se of semantic) {
          appendEvent(opts.cwd, opts.sneeblySessionId, se)
          if (se.kind === 'turn_end') sawTurnEnd = true
        }
      }
    },
  }).then((result) => {
    activeProcesses.delete(opts.sneeblySessionId)
    activeChatProjectIds.delete(opts.projectId)

    if (opts.recordEvents && !sawTurnEnd) {
      const wasAborted = abortedSessions.has(opts.sneeblySessionId)
      appendEvent(opts.cwd, opts.sneeblySessionId, {
        id: crypto.randomUUID(),
        sessionId: opts.sneeblySessionId,
        projectId: opts.projectId,
        ts: Date.now(),
        kind: 'turn_end',
        source: 'chat',
        payload: {
          endReason: wasAborted ? 'stopped' : (result.error ? 'error' : 'completed'),
          error: result.error ?? null,
        },
      })
    }
    abortedSessions.delete(opts.sneeblySessionId)

    onDone(result.claudeCodeSessionId, result.error)
  }).catch((err: unknown) => {
    activeProcesses.delete(opts.sneeblySessionId)
    activeChatProjectIds.delete(opts.projectId)
    abortedSessions.delete(opts.sneeblySessionId)
    onDone(null, err instanceof Error ? err.message : String(err))
  })
}

export function abortSession(sneeblySessionId: string): void {
  abortedSessions.add(sneeblySessionId)
  const proc = activeProcesses.get(sneeblySessionId)
  if (!proc) return
  proc.kill('SIGTERM')
  const t = setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
  proc.on('exit', () => clearTimeout(t))
}

export function getActiveChatProjectIds(): ReadonlySet<string> {
  return activeChatProjectIds
}
