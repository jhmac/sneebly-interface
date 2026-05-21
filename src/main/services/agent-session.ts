import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentEvent } from '../../shared/types'
import { getAllSecrets } from './secrets-store'

// Binary path — use full path so Electron's minimal PATH doesn't miss it
const CLAUDE_BIN = process.env['CLAUDE_BIN'] ?? '/Users/mister/.local/bin/claude'

// Track active processes keyed by sessionId so agent:abort can find them
const activeProcesses = new Map<string, ChildProcess>()

export interface TurnOpts {
  cwd: string
  projectId: string             // for secrets injection
  sneeblySessionId: string      // Sneebly's UUID — JSONL filename, process map key
  claudeCodeSessionId?: string | null  // Claude's UUID — passed to --resume; null/undefined = first turn
  prompt: string
  model: string
}

export function startTurn(
  opts: TurnOpts,
  onEvent: (event: AgentEvent) => void,
  onDone: (claudeSessionId: string | null, error?: string) => void
): void {
  const args: string[] = [
    '-p', opts.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', opts.model,
    '--permission-mode', 'bypassPermissions',
  ]
  if (opts.claudeCodeSessionId) args.push('--resume', opts.claudeCodeSessionId)

  // Fetch secrets first, then spawn — errors silently fall back to no injection
  getAllSecrets(opts.projectId).catch(() => ({} as Record<string, string>)).then((secrets) => {
    const proc = spawn(CLAUDE_BIN, args, {
      cwd: opts.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...secrets },
    })

    activeProcesses.set(opts.sneeblySessionId, proc)

    let discoveredClaudeSessionId: string | null = null
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
        return
      }

      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        discoveredClaudeSessionId = event.session_id
      }

      onEvent(event)
    })

    proc.on('close', (code) => {
      activeProcesses.delete(opts.sneeblySessionId)
      if (code !== 0) {
        const stderr = stderrChunks.join('').trim()
        onDone(discoveredClaudeSessionId, stderr || `Process exited with code ${code}`)
      } else {
        onDone(discoveredClaudeSessionId)
      }
    })

    proc.on('error', (err) => {
      activeProcesses.delete(opts.sneeblySessionId)
      onDone(discoveredClaudeSessionId, err.message)
    })
  })
}

// Abort takes the Sneebly session ID (the process map key)
export function abortSession(sneeblySessionId: string): void {
  const proc = activeProcesses.get(sneeblySessionId)
  if (!proc) return
  proc.kill('SIGTERM')
  const t = setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
  proc.on('exit', () => clearTimeout(t))
}
