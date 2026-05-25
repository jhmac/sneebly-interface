import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PendingLearning, PromotedLearning, ShadowResult, ConventionKey } from '../../shared/types'

interface RejectedConvention {
  key: ConventionKey
  rejectedAt: number
}

interface ExtractionState {
  lastRunAt: number
  rejectedConventions: RejectedConvention[]
}

function learningsDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface', 'learnings')
}

function pendingFile(projectPath: string): string {
  return join(learningsDir(projectPath), 'pending.json')
}

function promotedFile(projectPath: string): string {
  return join(learningsDir(projectPath), 'promoted.json')
}

function promotedMdPath(projectPath: string): string {
  return join(learningsDir(projectPath), 'promoted.md')
}

function extractionStatePath(projectPath: string): string {
  return join(learningsDir(projectPath), 'extraction-state.json')
}

function ensureDir(projectPath: string): void {
  const dir = learningsDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readPendingRaw(projectPath: string): PendingLearning[] {
  const f = pendingFile(projectPath)
  if (!existsSync(f)) return []
  try {
    return JSON.parse(readFileSync(f, 'utf-8')) as PendingLearning[]
  } catch {
    return []
  }
}

function writePending(projectPath: string, entries: PendingLearning[]): void {
  ensureDir(projectPath)
  writeFileSync(pendingFile(projectPath), JSON.stringify(entries, null, 2), 'utf-8')
}

function readPromotedRaw(projectPath: string): PromotedLearning[] {
  const f = promotedFile(projectPath)
  if (!existsSync(f)) return []
  try {
    return JSON.parse(readFileSync(f, 'utf-8')) as PromotedLearning[]
  } catch {
    return []
  }
}

function writePromoted(projectPath: string, entries: PromotedLearning[]): void {
  ensureDir(projectPath)
  writeFileSync(promotedFile(projectPath), JSON.stringify(entries, null, 2), 'utf-8')
  rebuildPromotedMd(projectPath, entries)
}

function rebuildPromotedMd(projectPath: string, entries: PromotedLearning[]): void {
  const systemPromptEntries = entries.filter(
    (e) => !e.targetScope || e.targetScope === 'system-prompt'
  )
  if (systemPromptEntries.length === 0) {
    writeFileSync(promotedMdPath(projectPath), '', 'utf-8')
    return
  }
  const lines: string[] = [
    '## Promoted learnings',
    '',
    'These are patterns learned from prior sessions. Apply them silently when relevant:',
    '',
  ]
  for (const entry of systemPromptEntries) {
    lines.push(`### ${entry.title}`, '', entry.proposedChange, '')
  }
  writeFileSync(promotedMdPath(projectPath), lines.join('\n'), 'utf-8')
}

export function listPending(projectPath: string): PendingLearning[] {
  return readPendingRaw(projectPath)
}

export function listPromoted(projectPath: string): PromotedLearning[] {
  return readPromotedRaw(projectPath)
}

export function readPromotedMd(projectPath: string): string {
  const f = promotedMdPath(projectPath)
  if (!existsSync(f)) return ''
  try {
    return readFileSync(f, 'utf-8').trim()
  } catch {
    return ''
  }
}

export function addPending(
  projectPath: string,
  input: Omit<PendingLearning, 'id' | 'proposedAt' | 'shadowRuns'>
): PendingLearning {
  const entry: PendingLearning = {
    ...input,
    id: crypto.randomUUID(),
    proposedAt: Date.now(),
    shadowRuns: [],
  }
  const existing = readPendingRaw(projectPath)
  writePending(projectPath, [...existing, entry])
  return entry
}

export function appendShadowRun(
  projectPath: string,
  learningId: string,
  result: ShadowResult
): void {
  const entries = readPendingRaw(projectPath)
  const updated = entries.map((e) =>
    e.id === learningId ? { ...e, shadowRuns: [...e.shadowRuns, result] } : e
  )
  writePending(projectPath, updated)
}

export function promote(projectPath: string, learningId: string): void {
  const pending = readPendingRaw(projectPath)
  const entry = pending.find((e) => e.id === learningId)
  if (!entry) return
  writePending(projectPath, pending.filter((e) => e.id !== learningId))
  const promoted: PromotedLearning = {
    id: entry.id,
    promotedAt: Date.now(),
    sourceReflectionDate: entry.sourceReflectionDate,
    title: entry.title,
    proposedChange: entry.proposedChange,
    ...(entry.targetScope ? { targetScope: entry.targetScope } : {}),
    ...(entry.conventionKey ? { conventionKey: entry.conventionKey } : {}),
  }
  writePromoted(projectPath, [...readPromotedRaw(projectPath), promoted])
}

export function reject(projectPath: string, learningId: string): void {
  const pending = readPendingRaw(projectPath)
  writePending(projectPath, pending.filter((e) => e.id !== learningId))
}

export function revert(projectPath: string, learningId: string): void {
  const promoted = readPromotedRaw(projectPath)
  writePromoted(projectPath, promoted.filter((e) => e.id !== learningId))
}

export function pendingCount(projectPath: string): number {
  return readPendingRaw(projectPath).length
}

export function getExtractionState(projectPath: string): ExtractionState {
  const f = extractionStatePath(projectPath)
  if (!existsSync(f)) return { lastRunAt: 0, rejectedConventions: [] }
  try {
    return JSON.parse(readFileSync(f, 'utf-8')) as ExtractionState
  } catch {
    return { lastRunAt: 0, rejectedConventions: [] }
  }
}

export function setExtractionState(projectPath: string, state: ExtractionState): void {
  ensureDir(projectPath)
  writeFileSync(extractionStatePath(projectPath), JSON.stringify(state, null, 2), 'utf-8')
}

export function addRejectedConvention(projectPath: string, key: ConventionKey): void {
  const state = getExtractionState(projectPath)
  const filtered = state.rejectedConventions.filter((r) => r.key !== key)
  filtered.push({ key, rejectedAt: Date.now() })
  setExtractionState(projectPath, { ...state, rejectedConventions: filtered })
}

const REJECTION_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

export function isConventionRecentlyRejected(projectPath: string, key: ConventionKey): boolean {
  const state = getExtractionState(projectPath)
  const rejection = state.rejectedConventions.find((r) => r.key === key)
  if (!rejection) return false
  return Date.now() - rejection.rejectedAt < REJECTION_COOLDOWN_MS
}
