import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentEvent } from '../../shared/types'

// Binary path — use full path so Electron's minimal PATH doesn't miss it
const CLAUDE_BIN = process.env['CLAUDE_BIN'] ?? '/Users/mister/.local/bin/claude'

// Track active processes keyed by sessionId so agent:abort can find them
const activeProcesses = new Map<string, ChildProcess>()

export interface TurnOpts {
  cwd: string
  sessionId: string | null
  prompt: string
  model: string
}

export function startTurn(
  opts: TurnOpts,
  onEvent: (event: AgentEvent) => void,
  onDone: (sessionId: string | null, error?: string) => void
): void {
  const args: string[] = [
    '-p', opts.prompt,
    '--output-format', 'stream-json',
    '--model', opts.model,
    '--permission-mode', 'acceptEdits',
  ]
  if (opts.sessionId) args.push('--resume', opts.sessionId)

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: opts.cwd,
    shell: false,
    env: { ...process.env },
  })

  // Track before we know the real session_id
  const trackingKey = opts.sessionId ?? `pending-${Date.now()}`
  activeProcesses.set(trackingKey, proc)

  let resolvedSessionId = opts.sessionId
  const stderrChunks: string[] = []

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString())
  })

  const rl = createInterface({ input: proc.stdout!, terminal: false })

  rl.on('line', (line) => {
    if (!line.trim()) return
    let event: AgentEvent
    try {
      event = JSON.parse(line) as AgentEvent
    } catch {
      return // skip non-JSON lines (warnings etc.)
    }

    // Capture the real session_id from the first system_init event
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      if (resolvedSessionId !== event.session_id) {
        activeProcesses.delete(trackingKey)
        resolvedSessionId = event.session_id
        activeProcesses.set(resolvedSessionId, proc)
      }
    }

    onEvent(event)
  })

  proc.on('close', (code) => {
    activeProcesses.delete(resolvedSessionId ?? trackingKey)
    if (code !== 0) {
      const stderr = stderrChunks.join('').trim()
      onDone(resolvedSessionId, stderr || `Process exited with code ${code}`)
    } else {
      onDone(resolvedSessionId)
    }
  })

  proc.on('error', (err) => {
    activeProcesses.delete(resolvedSessionId ?? trackingKey)
    onDone(resolvedSessionId, err.message)
  })
}

export function abortSession(sessionId: string): void {
  const proc = activeProcesses.get(sessionId)
  if (!proc) return
  proc.kill('SIGTERM')
  const t = setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
  proc.on('exit', () => clearTimeout(t))
}
