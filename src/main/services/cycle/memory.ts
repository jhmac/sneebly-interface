import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export type FailedApproach = {
  constraint: string
  failureType: 'execution' | 'plan' | 'spec'
  reasoning: string
  ts: string
  cycleId: string
}

function memoryPath(projectRoot: string): string {
  return join(projectRoot, '.sneebly', 'failed-approaches.json')
}

export function loadFailedApproaches(projectRoot: string): FailedApproach[] {
  const p = memoryPath(projectRoot)
  if (!existsSync(p)) return []
  try { return JSON.parse(readFileSync(p, 'utf8')) as FailedApproach[] } catch { return [] }
}

export function recordFailedApproach(projectRoot: string, approach: Omit<FailedApproach, 'ts'>): void {
  const existing = loadFailedApproaches(projectRoot)
  existing.push({ ...approach, ts: new Date().toISOString() })
  const trimmed = existing.slice(-100)
  mkdirSync(dirname(memoryPath(projectRoot)), { recursive: true })
  writeFileSync(memoryPath(projectRoot), JSON.stringify(trimmed, null, 2))
}

export function getFailuresForConstraint(projectRoot: string, constraint: string): FailedApproach[] {
  return loadFailedApproaches(projectRoot).filter(a => a.constraint === constraint)
}

export function hasRepeatedFailure(projectRoot: string, constraint: string, threshold = 3): boolean {
  return getFailuresForConstraint(projectRoot, constraint).length >= threshold
}
