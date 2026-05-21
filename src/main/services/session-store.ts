import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
} from 'fs'
import { join } from 'path'
import type { ChatMessage, SessionSummary } from '../../shared/types'

function sessionsDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface', 'sessions')
}

function sessionFile(projectPath: string, sessionId: string): string {
  return join(sessionsDir(projectPath), `${sessionId}.jsonl`)
}

function ensureDir(projectPath: string): void {
  const dir = sessionsDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function createSession(projectPath: string): string {
  ensureDir(projectPath)
  const id = crypto.randomUUID()
  writeFileSync(sessionFile(projectPath, id), '', 'utf-8')
  return id
}

export function appendMessage(projectPath: string, sessionId: string, msg: ChatMessage): void {
  ensureDir(projectPath)
  appendFileSync(sessionFile(projectPath, sessionId), JSON.stringify(msg) + '\n', 'utf-8')
}

export function loadMessages(projectPath: string, sessionId: string): ChatMessage[] {
  const f = sessionFile(projectPath, sessionId)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ChatMessage)
}

export function clearSession(projectPath: string, sessionId: string): void {
  const f = sessionFile(projectPath, sessionId)
  if (existsSync(f)) writeFileSync(f, '', 'utf-8')
}

export function listSessions(projectPath: string): SessionSummary[] {
  const dir = sessionsDir(projectPath)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const id = f.replace('.jsonl', '')
      const msgs = loadMessages(projectPath, id)
      const firstUser = msgs.find((m) => m.role === 'user')
      return {
        id,
        createdAt: msgs[0]?.ts ?? 0,
        lastMessageAt: msgs[msgs.length - 1]?.ts ?? 0,
        messageCount: msgs.length,
        preview: (firstUser?.text ?? '(empty)').slice(0, 80),
      } satisfies SessionSummary
    })
    .filter((s) => s.messageCount > 0)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
}
