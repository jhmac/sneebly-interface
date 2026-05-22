import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type JournalEvent =
  | 'cycle-start' | 'cycle-end'
  | 'plan-complete' | 'build-complete' | 'verify-fail' | 'reflect-complete'
  | 'committed' | 'queued' | 'deployed-ok' | 'deployed-failed'
  | 'git-pull-failed' | 'checksum-mismatch' | 'security-alert'
  | 'phase-complete' | 'blocked'

export type JournalEntry = {
  id: string
  ts: string
  project: string
  event: JournalEvent
  cycleId: string
  data: Record<string, unknown>
}

export function journalPath(projectRoot: string): string {
  return join(projectRoot, '.sneebly', 'journal', 'heartbeat.jsonl')
}

export function writeJournal(
  projectRoot: string,
  event: JournalEvent,
  cycleId: string,
  data: Record<string, unknown>
): void {
  const jPath = journalPath(projectRoot)
  mkdirSync(dirname(jPath), { recursive: true })
  const entry: JournalEntry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    project: projectRoot.split('/').pop() ?? projectRoot,
    event,
    cycleId,
    data,
  }
  appendFileSync(jPath, JSON.stringify(entry) + '\n')
}

export function readJournal(projectRoot: string, limit = 20): JournalEntry[] {
  const jPath = journalPath(projectRoot)
  if (!existsSync(jPath)) return []
  const lines = readFileSync(jPath, 'utf8').trim().split('\n').filter(Boolean)
  return lines
    .slice(-limit)
    .map(l => { try { return JSON.parse(l) as JournalEntry } catch { return null } })
    .filter((e): e is JournalEntry => e !== null)
}
