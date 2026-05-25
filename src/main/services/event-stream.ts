import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'fs'
import { join } from 'path'
import type { SemanticEvent, FrictionTag, AgentEvent, AgentEventSource } from '../../shared/types'

// ── Paths ──────────────────────────────────────────────────────────────────

function sneeblyDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface')
}

function eventsDir(projectPath: string): string {
  return join(sneeblyDir(projectPath), 'events')
}

function reflectionsDir(projectPath: string): string {
  return join(sneeblyDir(projectPath), 'reflections')
}

function eventFile(projectPath: string, sessionId: string): string {
  return join(eventsDir(projectPath), `${sessionId}.jsonl`)
}

// ── Directory setup ────────────────────────────────────────────────────────

function ensureEventsDir(projectPath: string): void {
  const dir = eventsDir(projectPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    // Write gitignore on first creation of the events dir
    const gitignorePath = join(sneeblyDir(projectPath), '.gitignore')
    const addition = 'events/\nreflections/\nlearnings/\n'
    if (existsSync(gitignorePath)) {
      const current = readFileSync(gitignorePath, 'utf-8')
      if (!current.includes('events/')) {
        writeFileSync(gitignorePath, current.trimEnd() + '\n' + addition, 'utf-8')
      }
    } else {
      writeFileSync(gitignorePath, addition, 'utf-8')
    }
  }
}

// ── Core I/O ───────────────────────────────────────────────────────────────

export function appendEvent(projectPath: string, sessionId: string, event: SemanticEvent): void {
  ensureEventsDir(projectPath)
  appendFileSync(eventFile(projectPath, sessionId), JSON.stringify(event) + '\n', 'utf-8')
}

export function readSessionEvents(projectPath: string, sessionId: string): SemanticEvent[] {
  const f = eventFile(projectPath, sessionId)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SemanticEvent)
}

export function readEventsForDateRange(projectPath: string, fromTs: number, toTs: number): SemanticEvent[] {
  const dir = eventsDir(projectPath)
  if (!existsSync(dir)) return []
  const result: SemanticEvent[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue
    const sessionId = file.slice(0, -6)
    for (const event of readSessionEvents(projectPath, sessionId)) {
      if (event.ts >= fromTs && event.ts < toTs) result.push(event)
    }
  }
  return result.sort((a, b) => a.ts - b.ts)
}

export function deleteAllEvents(projectPath: string): void {
  const eDir = eventsDir(projectPath)
  const rDir = reflectionsDir(projectPath)
  if (existsSync(eDir)) rmSync(eDir, { recursive: true, force: true })
  if (existsSync(rDir)) rmSync(rDir, { recursive: true, force: true })
}

// ── Friction tagging ───────────────────────────────────────────────────────

export const CORRECTION_RE = /^(no|stop|wrong|undo|actually|instead)\b/i

export function tagFriction(events: SemanticEvent[]): SemanticEvent[] {
  const tagged = events.map((e) => ({
    ...e,
    frictionTags: [...(e.frictionTags ?? [])] as FrictionTag[],
  }))

  // key: toolName + serialized args → last call timestamp
  const lastToolCall = new Map<string, number>()

  for (let i = 0; i < tagged.length; i++) {
    const ev = tagged[i]!

    if (ev.kind === 'user_message') {
      const text = String(ev.payload['text'] ?? '').trimStart()
      if (CORRECTION_RE.test(text)) addTag(ev, 'user_correction')
    }

    if (ev.kind === 'permission_denied') {
      addTag(ev, 'permission_denied')
    }

    if (ev.kind === 'tool_call') {
      const key = `${ev.payload['toolName']}::${JSON.stringify(ev.payload['args'] ?? {})}`
      const last = lastToolCall.get(key)
      if (last !== undefined && ev.ts - last < 60_000) addTag(ev, 'tool_retry')
      lastToolCall.set(key, ev.ts)
    }

    if (ev.kind === 'tool_result' && ev.payload['isError'] === true) {
      addTag(ev, 'tool_error')
    }

    if (ev.kind === 'turn_end' && ev.payload['endReason'] === 'stopped') {
      for (let j = Math.max(0, i - 5); j < i; j++) addTag(tagged[j]!, 'turn_stopped')
    }
  }

  return tagged
}

function addTag(ev: SemanticEvent & { frictionTags: FrictionTag[] }, tag: FrictionTag): void {
  if (!ev.frictionTags.includes(tag)) ev.frictionTags.push(tag)
}

// ── Agent event → SemanticEvent transformation ─────────────────────────────

export function agentEventToSemanticEvents(
  agentEvent: AgentEvent,
  sessionId: string,
  projectId: string,
  source: AgentEventSource
): SemanticEvent[] {
  const base = { sessionId, projectId, source }

  switch (agentEvent.type) {
    case 'system':
      if (agentEvent.subtype !== 'init') return []
      return [{
        ...base,
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'turn_start',
        payload: { claudeSessionId: agentEvent.session_id, model: agentEvent.model ?? null },
      }]

    case 'assistant': {
      const out: SemanticEvent[] = []
      for (const block of agentEvent.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          out.push({
            ...base,
            id: crypto.randomUUID(),
            ts: Date.now(),
            kind: 'assistant_message',
            payload: { text: block.text.slice(0, 500) },
          })
        } else if (block.type === 'tool_use') {
          out.push({
            ...base,
            id: crypto.randomUUID(),
            ts: Date.now(),
            kind: 'tool_call',
            payload: {
              toolName: block.name,
              toolUseId: block.id,
              args: summarizeArgs(block.name, block.input),
            },
          })
        }
      }
      return out
    }

    case 'user': {
      const out: SemanticEvent[] = []
      for (const block of agentEvent.message.content) {
        const raw = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
        out.push({
          ...base,
          id: crypto.randomUUID(),
          ts: Date.now(),
          kind: 'tool_result',
          payload: {
            toolUseId: block.tool_use_id,
            isError: block.is_error ?? false,
            snippet: raw.slice(0, 2048),
          },
        })
      }
      return out
    }

    case 'result':
      return [{
        ...base,
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'turn_end',
        payload: {
          endReason: agentEvent.subtype === 'success' ? 'completed' : 'error',
          durationMs: agentEvent.duration_ms ?? null,
          costUsd: agentEvent.total_cost_usd ?? null,
          usage: agentEvent.usage ? {
            inputTokens: agentEvent.usage.input_tokens,
            outputTokens: agentEvent.usage.output_tokens,
            cacheReadTokens: agentEvent.usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: agentEvent.usage.cache_creation_input_tokens ?? 0,
          } : null,
        },
      }]

    case 'error':
      return [{
        ...base,
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'turn_end',
        payload: { endReason: 'error', error: agentEvent.message },
      }]

    default:
      return []
  }
}

// Never send full file contents in stored events
function summarizeArgs(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const name = toolName.toLowerCase()
  if (name === 'read' || name === 'readfile') {
    return {
      file_path: input['file_path'],
      limit: input['limit'] ?? null,
      offset: input['offset'] ?? null,
    }
  }
  if (name === 'edit' || name === 'multiedit') {
    return { file_path: input['file_path'], payloadSize: JSON.stringify(input).length }
  }
  if (name === 'write') {
    return { file_path: input['file_path'], payloadSize: JSON.stringify(input).length }
  }
  if (name === 'bash') {
    return { command: String(input['command'] ?? '').slice(0, 500) }
  }
  // Generic: include all keys but truncate long string values
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    out[k] = s.length > 500 ? s.slice(0, 500) + '…' : v
  }
  return out
}
