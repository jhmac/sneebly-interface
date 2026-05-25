import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'events'
import type { AgentEvent, SessionUsage } from '../../shared/types'
import { runStandaloneTurn } from './standalone-turn'
import { appendEvent, agentEventToSemanticEvents } from './event-stream'
import { appendSessionUsage } from './usage-store'

// Keyed by sneeblySessionId for abort support
const activeProcesses = new Map<string, ChildProcess>()

// Tracks sessions killed via abortSession — used to distinguish stop vs error
const abortedSessions = new Set<string>()

// Which projectIds have an active chat turn — read by the daemon's soft lock
const activeChatProjectIds = new Set<string>()

// Emits 'turn-end' with { projectId, error } when any turn finishes — consumed by phase runner
export const turnEmitter = new EventEmitter()

export interface TurnMetrics {
  filesTouched: string[]
  linesChanged: number
  wasAborted: boolean
}

export interface TurnOpts {
  cwd: string
  projectId: string
  sneeblySessionId: string
  claudeCodeSessionId?: string | null
  prompt: string
  model: string
  appendSystemPrompt?: string
  recordEvents?: boolean
  recordUsage?: boolean
  isAutoReview?: boolean
}

export function startTurn(
  opts: TurnOpts,
  onEvent: (event: AgentEvent) => void,
  onDone: (claudeSessionId: string | null, error?: string | undefined, metrics?: TurnMetrics) => void
): void {
  activeChatProjectIds.add(opts.projectId)
  const turnStartedAt = Date.now()
  let sawTurnEnd = false
  const filesTouched = new Set<string>()
  let linesChanged = 0

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

      // Track file edits for auto-review threshold
      if (!opts.isAutoReview && richEvent.type === 'assistant') {
        for (const block of richEvent.message.content) {
          if (block.type !== 'tool_use') continue
          const input = block.input
          if (block.name === 'Edit' || block.name === 'Write') {
            const fp = (input['file_path'] ?? input['path']) as string | undefined
            if (fp) filesTouched.add(fp)
            const newContent = block.name === 'Edit'
              ? (input['new_string'] as string) ?? ''
              : (input['content'] as string) ?? ''
            linesChanged += newContent.split('\n').length
          } else if (block.name === 'MultiEdit') {
            const fp = (input['file_path'] ?? input['path']) as string | undefined
            if (fp) filesTouched.add(fp)
            const edits = (input['edits'] as Array<{ old_string: string; new_string: string }>) ?? []
            for (const edit of edits) {
              linesChanged += (edit.new_string ?? '').split('\n').length
            }
          }
        }
      }

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

    const wasAborted = abortedSessions.has(opts.sneeblySessionId)
    abortedSessions.delete(opts.sneeblySessionId)

    if (opts.recordEvents && !sawTurnEnd) {
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
          usage: {
            inputTokens: result.tokensIn,
            outputTokens: result.tokensOut,
            cacheReadTokens: result.cacheReadTokens,
            cacheCreationTokens: result.cacheCreationTokens,
          },
        },
      })
    }

    if (opts.recordUsage !== false) {
      const usage: SessionUsage = {
        sessionId: opts.sneeblySessionId,
        startedAt: turnStartedAt,
        endedAt: Date.now(),
        inputTokens: result.tokensIn,
        outputTokens: result.tokensOut,
        cacheReadTokens: result.cacheReadTokens,
        cacheCreationTokens: result.cacheCreationTokens,
        durationMs: result.durationMs,
        turnCount: 1,
        wasStopped: wasAborted,
      }
      try { appendSessionUsage(opts.cwd, usage) } catch (e) {
        console.error('[Sneebly] Failed to write token usage:', e)
      }
    }

    const metrics: TurnMetrics = { filesTouched: [...filesTouched], linesChanged, wasAborted }
    turnEmitter.emit('turn-end', { projectId: opts.projectId, error: result.error ?? null })
    onDone(result.claudeCodeSessionId, result.error, metrics)
  }).catch((err: unknown) => {
    activeProcesses.delete(opts.sneeblySessionId)
    activeChatProjectIds.delete(opts.projectId)
    const wasAborted = abortedSessions.has(opts.sneeblySessionId)
    abortedSessions.delete(opts.sneeblySessionId)
    if (opts.recordUsage !== false) {
      try {
        appendSessionUsage(opts.cwd, {
          sessionId: opts.sneeblySessionId,
          startedAt: turnStartedAt,
          endedAt: Date.now(),
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
          durationMs: Date.now() - turnStartedAt,
          turnCount: 1,
          wasStopped: wasAborted,
        })
      } catch { /* ignore — don't crash on usage write failure */ }
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    turnEmitter.emit('turn-end', { projectId: opts.projectId, error: errMsg })
    onDone(null, errMsg, { filesTouched: [], linesChanged: 0, wasAborted })
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

export function isChatTurnInFlight(projectId: string): boolean {
  return activeChatProjectIds.has(projectId)
}

export function getActiveChatProjectIds(): ReadonlySet<string> {
  return activeChatProjectIds
}
