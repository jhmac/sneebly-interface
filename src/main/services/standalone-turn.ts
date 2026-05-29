import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentEvent } from '../../shared/types'
import { getAllSecrets } from './secrets-store'
import { getMcpConfigPath } from './mcp-config'

const CLAUDE_BIN = process.env['CLAUDE_BIN'] ?? '/Users/mister/.local/bin/claude'

// Rolling cap on stderr buffering — keeps the tail (most recent, most useful).
const STDERR_CAP = 8 * 1024

// Rolling cap on the retained event array. A normal turn emits well under this;
// the bound only bites a runaway/looping stream (the secondary OOM path). Live
// consumers still get every event via onEvent — only the retained tail is capped.
// Trim in slack-sized batches so the amortised cost stays O(1) per event.
const MAX_EVENTS = 1000
const EVENTS_TRIM_AT = 1500

export interface StandaloneTurnOpts {
  cwd: string
  projectId: string
  prompt: string
  model: 'claude-sonnet-4-6' | 'claude-opus-4-8' | 'claude-haiku-4-5'
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'plan' | 'default'
  resumeSessionId?: string | null
  maxTurns?: number
  allowedTools?: string[]
  appendSystemPrompt?: string
  extraArgs?: string[]
  // When true, pass --include-partial-messages so claude-code emits content_block_delta
  // events (wrapped in stream_event); these are translated to AgentPartialTextEvent and
  // forwarded via onEvent for token-level streaming. Default off — existing callers unchanged.
  includePartialMessages?: boolean
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

// claude-code wraps Anthropic streaming events as { type: 'stream_event', event: {...} }.
// Pull out a text_delta if this line is one; returns null otherwise.
function extractPartialText(raw: unknown): { blockIndex: number; textDelta: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as {
    type?: string
    event?: { type?: string; index?: number; delta?: { type?: string; text?: string } }
  }
  if (e.type !== 'stream_event' || !e.event) return null
  if (e.event.type !== 'content_block_delta' || e.event.delta?.type !== 'text_delta') return null
  return { blockIndex: e.event.index ?? 0, textDelta: e.event.delta.text ?? '' }
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
  if (opts.includePartialMessages) args.push('--include-partial-messages')
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

    let stderrBuf = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      if (stderrBuf.length > STDERR_CAP) {
        stderrBuf = stderrBuf.slice(stderrBuf.length - STDERR_CAP)
      }
    })

    const rl = createInterface({ input: proc.stdout!, terminal: false })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let event: AgentEvent
      try { event = JSON.parse(line) as AgentEvent } catch { return }

      events.push(event)
      // Drop the oldest events once we exceed the trim threshold, keeping the most
      // recent MAX_EVENTS (which include the terminal `result` and any error events).
      if (events.length >= EVENTS_TRIM_AT) {
        events.splice(0, events.length - MAX_EVENTS)
      }

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

      // Token-level streaming: unwrap stream_event text deltas into a synthetic
      // partial_text event. The raw stream_event is not forwarded (it would be noise);
      // the full assistant message still fires normally at the block boundary.
      if (opts.includePartialMessages) {
        const delta = extractPartialText(event)
        if (delta) {
          opts.onEvent?.({ type: 'partial_text', blockIndex: delta.blockIndex, textDelta: delta.textDelta })
          return
        }
      }

      opts.onEvent?.(event)
    })

    proc.on('close', (code) => {
      const durationMs = Date.now() - start
      let error: string | undefined
      if (code !== 0 && !assistantText) {
        // Prefer structured error messages from the JSON event stream.
        // Two shapes: { type: "error", message: "..." } (CLI-layer errors, emitted on stdout)
        // and { type: "result", subtype: "error", error: "..." } (API-layer errors: context
        // window exceeded, rate limit, auth failures — the primary carrier from claude -p).
        const errorMessages: string[] = []
        for (const e of events) {
          if (e.type === 'error') {
            // { type: "error", message: "..." } — CLI-level error
            const msg = (e as AgentEvent & { message?: string }).message
            if (msg) errorMessages.push(msg)
          } else if (e.type === 'result' && e.is_error) {
            // { type: "result", is_error: true } — covers all error subtypes:
            //   subtype "error"          → API-level (context window, rate limit, auth)
            //   subtype "error_max_turns"→ --max-turns exceeded before producing output
            //   (and any future subtypes the CLI may add)
            // Prefer the errors[] array (present on error_max_turns); fall back to error.
            const msgs = e.errors?.length ? e.errors : e.error ? [e.error] : []
            errorMessages.push(...msgs)
          }
        }
        const stderrTail = stderrBuf.slice(-500).trim()
        if (errorMessages.length > 0) {
          const body = errorMessages.join('\n')
          error = stderrTail ? `${body}\n\nstderr: ${stderrTail}` : body
        } else if (stderrTail) {
          error = `Process exited with code ${code}. stderr: ${stderrTail}`
        } else {
          error = `Process exited with code ${code}`
        }
      }
      resolve({
        events, assistantText, claudeCodeSessionId,
        durationMs, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, costUsd,
        error,
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
