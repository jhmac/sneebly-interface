import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SessionUsage, ProjectTokensFile, UsageSummary, UsageDailyStat } from '../../shared/types'
import { tsToDateKey } from '../../shared/utils'

function sneeblyDir(projectPath: string): string {
  return join(projectPath, '.sneebly-interface')
}

function tokensFilePath(projectPath: string): string {
  return join(sneeblyDir(projectPath), 'tokens.json')
}

function ensureDir(projectPath: string): void {
  const dir = sneeblyDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function ensureGitignore(projectPath: string): void {
  const gitignorePath = join(sneeblyDir(projectPath), '.gitignore')
  const entry = 'tokens.json\n'
  if (existsSync(gitignorePath)) {
    const current = readFileSync(gitignorePath, 'utf-8')
    if (!current.includes('tokens.json')) {
      writeFileSync(gitignorePath, current.trimEnd() + '\n' + entry, 'utf-8')
    }
  } else {
    writeFileSync(gitignorePath, entry, 'utf-8')
  }
}

export function readSessionUsage(projectPath: string): SessionUsage[] {
  const path = tokensFilePath(projectPath)
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ProjectTokensFile
    return parsed.sessions ?? []
  } catch {
    console.error(`[Sneebly] usage-store: corrupt tokens.json at ${path}, returning []`)
    return []
  }
}

// Appends or merges a single turn's usage into the session's running total.
// The incoming `usage` represents one turn (turnCount should be 1).
export function appendSessionUsage(projectPath: string, usage: SessionUsage): void {
  ensureDir(projectPath)

  const isNewFile = !existsSync(tokensFilePath(projectPath))
  if (isNewFile) ensureGitignore(projectPath)

  const existing = readSessionUsage(projectPath)
  const idx = existing.findIndex((s) => s.sessionId === usage.sessionId)

  let merged: SessionUsage
  if (idx >= 0) {
    const prev = existing[idx]!
    merged = {
      sessionId: usage.sessionId,
      startedAt: Math.min(prev.startedAt, usage.startedAt),
      endedAt: Math.max(prev.endedAt, usage.endedAt),
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
      cacheCreationTokens: prev.cacheCreationTokens + usage.cacheCreationTokens,
      durationMs: prev.durationMs + usage.durationMs,
      turnCount: prev.turnCount + usage.turnCount,
      wasStopped: prev.wasStopped || usage.wasStopped,
    }
    existing[idx] = merged
  } else {
    existing.push(usage)
  }

  const file: ProjectTokensFile = { sessions: existing, updatedAt: Date.now() }
  writeFileSync(tokensFilePath(projectPath), JSON.stringify(file, null, 2), 'utf-8')
}

export function summarize(projectPath: string, fromTs: number, toTs: number): UsageSummary {
  const sessions = readSessionUsage(projectPath).filter(
    (s) => s.endedAt >= fromTs && s.startedAt < toTs
  )
  return {
    totalInput: sessions.reduce((n, s) => n + s.inputTokens, 0),
    totalOutput: sessions.reduce((n, s) => n + s.outputTokens, 0),
    totalCacheRead: sessions.reduce((n, s) => n + s.cacheReadTokens, 0),
    totalCacheCreation: sessions.reduce((n, s) => n + s.cacheCreationTokens, 0),
    totalDurationMs: sessions.reduce((n, s) => n + s.durationMs, 0),
    sessionCount: sessions.length,
    turnCount: sessions.reduce((n, s) => n + s.turnCount, 0),
    stoppedSessionCount: sessions.filter((s) => s.wasStopped).length,
  }
}

export function timeseries(projectPath: string, fromTs: number, toTs: number): UsageDailyStat[] {
  const sessions = readSessionUsage(projectPath).filter(
    (s) => s.endedAt >= fromTs && s.startedAt < toTs
  )

  const byDate = new Map<string, UsageDailyStat>()
  for (const s of sessions) {
    const date = tsToDateKey(s.endedAt)
    const existing = byDate.get(date) ?? { date, totalInput: 0, totalOutput: 0, durationMs: 0, sessionCount: 0 }
    byDate.set(date, {
      date,
      totalInput: existing.totalInput + s.inputTokens,
      totalOutput: existing.totalOutput + s.outputTokens,
      durationMs: existing.durationMs + s.durationMs,
      sessionCount: existing.sessionCount + 1,
    })
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}
