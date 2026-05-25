import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentEvent } from '../../shared/types'
import { getAllSecrets } from './secrets-store'
import { getMcpConfigPath } from './mcp-config'

const CLAUDE_BIN = process.env['CLAUDE_BIN'] ?? '/Users/mister/.local/bin/claude'

export interface StandaloneTurnOpts {
  cwd: string
  projectId: string
  prompt: string
  model: 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5'
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'plan' | 'default'
  resumeSessionId?: string | null
  maxTurns?: number
  allowedTools?: string[]
  appendSystemPrompt?: string
  extraArgs?: string[]
  onEvent?: (event: AgentEvent) => void
  // Called immediately after the process is spawned, before any events arrive.
  // Lets callers register the process for abort without exposing internals.
  onProcess?: (proc: import('node:child_process').ChildProcess) => void
}

export interface StandaloneTurnResult {
  events: AgentEvent[]
  assistantText: string
  claudeCodeSessionId: string | null
  durationMs: number
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  error?: string
}

// Ported from V3's claude-code.ts — extracts the first valid JSON object from
// a string using four strategies of increasing permissiveness.
export function extractJson<T>(output: string): T | null {
  const jsonFence = output.match(/```json\s*\n([\s\S]*?)\n\s*```/)
  if (jsonFence) {
    try { return JSON.parse(jsonFence[1]) as T } catch { /* fall through */ }
  }

  const bareFence = output.match(/```\s*\n([\s\S]*?)\n\s*```/)
  if (bareFence) {
    try { return JSON.parse(bareFence[1]) as T } catch { /* fall through */ }
  }

  const start = output.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < output.length; i++) {
      const ch = output[i]!
      if (escape) { escape = false; continue }
      if (ch === '\\' && inString) { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(output.slice(start, i + 1)) as T } catch { break }
        }
      }
    }
  }

  const jsonMatch = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!jsonMatch) return null
  try { return JSON.parse(jsonMatch[0]) as T } catch { return null }
}

export async function runStandaloneTurn(opts: StandaloneTurnOpts): Promise<StandaloneTurnResult> {
  const start = Date.now()
  const events: AgentEvent[] = []
  let assistantText = ''
  let claudeCodeSessionId: string | null = null
  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let costUsd = 0

  const args: string[] = [
    '-p', opts.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', opts.model,
    '--permission-mode', opts.permissionMode ?? 'bypassPermissions',
    '--mcp-config', getMcpConfigPath(),
  ]
  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns))
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','))
  }
  if (opts.appendSystemPrompt) args.push('--append-system-prompt', opts.appendSystemPrompt)
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)
  if (opts.extraArgs) args.push(...opts.extraArgs)

  let secrets: Record<string, string> = {}
  try { secrets = await getAllSecrets(opts.projectId) } catch { /* proceed without */ }

  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, args, {
      cwd: opts.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...secrets },
    })
    opts.onProcess?.(proc)

    const stderrChunks: string[] = []
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()))

    const rl = createInterface({ input: proc.stdout!, terminal: false })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let event: AgentEvent
      try { event = JSON.parse(line) as AgentEvent } catch { return }

      events.push(event)

      if (event.type === 'system' && event.subtype === 'init') {
        claudeCodeSessionId = event.session_id
      }
      if (event.type === 'result') {
        // result field is present in the wire format but not in our interface type
        assistantText = (event as AgentEvent & { result?: string }).result ?? ''
        tokensIn = event.usage?.input_tokens ?? 0
        tokensOut = event.usage?.output_tokens ?? 0
        cacheReadTokens = event.usage?.cache_read_input_tokens ?? 0
        cacheCreationTokens = event.usage?.cache_creation_input_tokens ?? 0
        costUsd = event.total_cost_usd ?? 0
      }

      opts.onEvent?.(event)
    })

    proc.on('close', (code) => {
      const durationMs = Date.now() - start
      const stderr = stderrChunks.join('').trim()
      resolve({
        events, assistantText, claudeCodeSessionId,
        durationMs, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, costUsd,
        error: (code !== 0 && !assistantText) ? (stderr || `Process exited with code ${code}`) : undefined,
      })
    })

    proc.on('error', (err) => {
      resolve({
        events, assistantText, claudeCodeSessionId,
        durationMs: Date.now() - start,
        tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, costUsd,
        error: err.message,
      })
    })
  })
}
