import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { readEventsForDateRange, tagFriction } from './event-stream'
import { runStandaloneTurn } from './standalone-turn'
import type { SemanticEvent, ReflectionEntry } from '../../shared/types'

// ── Paths ──────────────────────────────────────────────────────────────────

function reflectionsDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface', 'reflections')
}

function reflectionFile(projectPath: string, date: string): string {
  return join(reflectionsDir(projectPath), `${date}.md`)
}

// ── Date helpers ───────────────────────────────────────────────────────────

function dateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayRange(d: Date): { fromTs: number; toTs: number } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return { fromTs: start.getTime(), toTs: start.getTime() + 86_400_000 }
}

// ── Reflection content builder ─────────────────────────────────────────────

const REFLECTOR_SYSTEM_PROMPT = `You are the Reflector. You watched Claude Code work on a project today. Below is a structured trace of tool calls, user messages, and results. Write a short report (under 300 words, Markdown) answering:

1. What got stuck — repeated failures, user corrections, permission denials.
2. What got repeated — same patterns run multiple times that could be batched.
3. One concrete shortcut that would have saved the most time today.

Be specific. Name tools and file paths where relevant. Output only the report with no preamble.`

function buildEventsPrompt(events: SemanticEvent[]): string {
  const lines: string[] = []
  for (const ev of events) {
    const t = new Date(ev.ts).toISOString().slice(11, 19)
    const friction = ev.frictionTags?.length ? ` [${ev.frictionTags.join(',')}]` : ''
    switch (ev.kind) {
      case 'user_message':
        lines.push(`${t} USER: ${String(ev.payload['text'] ?? '').slice(0, 200)}${friction}`)
        break
      case 'tool_call': {
        const args = ev.payload['args'] as Record<string, unknown> | undefined
        const argStr = args
          ? Object.entries(args).map(([k, v]) => `${k}=${String(v).slice(0, 100)}`).join(', ')
          : ''
        lines.push(`${t} CALL ${ev.payload['toolName']}(${argStr})${friction}`)
        break
      }
      case 'tool_result':
        lines.push(`${t} RESULT ${ev.payload['toolUseId']} isError=${ev.payload['isError']}${friction}`)
        break
      case 'turn_end':
        lines.push(`${t} TURN_END reason=${ev.payload['endReason']}${friction}`)
        break
      case 'turn_start':
        lines.push(`${t} TURN_START`)
        break
      case 'assistant_message':
        lines.push(`${t} ASSISTANT: ${String(ev.payload['text'] ?? '').slice(0, 100)}`)
        break
      case 'permission_denied':
        lines.push(`${t} PERMISSION_DENIED${friction}`)
        break
    }
  }
  return lines.join('\n')
}

function countFriction(events: SemanticEvent[]): number {
  return events.reduce((n, e) => n + (e.frictionTags?.length ?? 0), 0)
}

// ── Main export ────────────────────────────────────────────────────────────

export async function runReflection(
  projectPath: string,
  projectId: string,
  date: Date
): Promise<{ path: string; summary: string }> {
  const dateStr = dateString(date)
  const { fromTs, toTs } = dayRange(date)

  const rawEvents = readEventsForDateRange(projectPath, fromTs, toTs)
  const events = tagFriction(rawEvents)
  const eventCount = events.length
  const frictionCount = countFriction(events)

  const model = eventCount > 500 ? 'claude-opus-4-7' : 'claude-sonnet-4-6'

  const prompt = `Project: ${projectPath}\nDate: ${dateStr}\nEvent count: ${eventCount}\n\n${buildEventsPrompt(events)}`

  const result = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt,
    model,
    permissionMode: 'default',
    allowedTools: ['Read'],
    appendSystemPrompt: REFLECTOR_SYSTEM_PROMPT,
    maxTurns: 1,
  })

  const body = result.assistantText.trim() || '(No reflection generated.)'

  const frontmatter = [
    '---',
    `date: ${dateStr}`,
    `eventCount: ${eventCount}`,
    `frictionCount: ${frictionCount}`,
    `model: ${model}`,
    '---',
    '',
  ].join('\n')

  const content = frontmatter + body

  const dir = reflectionsDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const outPath = reflectionFile(projectPath, dateStr)
  writeFileSync(outPath, content, 'utf-8')

  const summary = body.split(/\n{2,}/)[0]?.slice(0, 280) ?? body.slice(0, 280)
  return { path: outPath, summary }
}

// ── Listing ────────────────────────────────────────────────────────────────

export function listReflections(projectPath: string): ReflectionEntry[] {
  const dir = reflectionsDir(projectPath)
  if (!existsSync(dir)) return []

  const entries: ReflectionEntry[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    const date = file.slice(0, -3)
    const filePath = join(dir, file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const fm = parseFrontmatter(raw)
      const body = raw.slice(raw.indexOf('---', 3) + 3).trimStart()
      const summary = body.split(/\n{2,}/)[0]?.slice(0, 280) ?? body.slice(0, 280)
      entries.push({
        date,
        path: filePath,
        eventCount: Number(fm['eventCount'] ?? 0),
        frictionCount: Number(fm['frictionCount'] ?? 0),
        summary,
      })
    } catch {
      // skip malformed files
    }
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date))
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!content.startsWith('---')) return result
  const end = content.indexOf('---', 3)
  if (end === -1) return result
  const block = content.slice(3, end)
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    if (key) result[key] = val
  }
  return result
}

// ── Boot scheduler helper ──────────────────────────────────────────────────

export function reflectionNeeded(projectPath: string): boolean {
  const today = dateString(new Date())
  return !existsSync(reflectionFile(projectPath, today))
}

export function hasEnoughEventsToday(projectPath: string, threshold = 10): boolean {
  const { fromTs, toTs } = dayRange(new Date())
  const events = readEventsForDateRange(projectPath, fromTs, toTs)
  return events.length >= threshold
}
