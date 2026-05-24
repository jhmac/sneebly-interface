import { type ChildProcess } from 'node:child_process'
import type { AgentEvent } from '../../shared/types'
import { runStandaloneTurn } from './standalone-turn'

// Keyed by sneeblySessionId for abort support
const activeProcesses = new Map<string, ChildProcess>()

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
}

export function startTurn(
  opts: TurnOpts,
  onEvent: (event: AgentEvent) => void,
  onDone: (claudeSessionId: string | null, error?: string) => void
): void {
  activeChatProjectIds.add(opts.projectId)

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
      onEvent({ ...event, source: 'chat' } as AgentEvent)
    },
  }).then((result) => {
    activeProcesses.delete(opts.sneeblySessionId)
    activeChatProjectIds.delete(opts.projectId)
    onDone(result.claudeCodeSessionId, result.error)
  }).catch((err: unknown) => {
    activeProcesses.delete(opts.sneeblySessionId)
    activeChatProjectIds.delete(opts.projectId)
    onDone(null, err instanceof Error ? err.message : String(err))
  })
}

export function abortSession(sneeblySessionId: string): void {
  const proc = activeProcesses.get(sneeblySessionId)
  if (!proc) return
  proc.kill('SIGTERM')
  const t = setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
  proc.on('exit', () => clearTimeout(t))
}

export function getActiveChatProjectIds(): ReadonlySet<string> {
  return activeChatProjectIds
}
