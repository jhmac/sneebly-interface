import { statSync } from 'node:fs'
import { join } from 'node:path'
import Store from 'electron-store'
import type { Project, DaemonProjectConfig } from '../../../shared/types'
import { readJournal } from './journal'

const store = new Store()

const MIN_COOLDOWN_MS = 15 * 60 * 1000
const SOFT_CAP = 20
const HARD_CAP = 40

export type ProjectScore = {
  project: Project
  score: number
  eligible: boolean
  skipReason?: string
}

export function getDaemonEnabled(): boolean {
  return store.get('daemon.enabled', false) as boolean
}

export function getProjectConfig(projectId: string): DaemonProjectConfig {
  const defaults: DaemonProjectConfig = {
    enabled: false,
    schedule: 'manual',
    weight: 1.0,
    lastCycleAt: null,
    lastCycleOutcome: null,
  }
  return { ...defaults, ...(store.get(`daemon.projects.${projectId}`, {}) as Partial<DaemonProjectConfig>) }
}

export function setProjectConfig(projectId: string, config: Partial<DaemonProjectConfig>): void {
  const current = getProjectConfig(projectId)
  store.set(`daemon.projects.${projectId}`, { ...current, ...config })
}

export function recordCycleOutcome(projectId: string, outcome: string): void {
  setProjectConfig(projectId, {
    lastCycleAt: Date.now(),
    lastCycleOutcome: outcome,
  })
}

function cyclesForProjectToday(projectRoot: string): number {
  const journal = readJournal(projectRoot, 100)
  const today = new Date().toISOString().slice(0, 10)
  return journal.filter(e => e.event === 'cycle-start' && e.ts.startsWith(today)).length
}

function msSinceLastCycle(projectId: string): number {
  const config = getProjectConfig(projectId)
  if (!config.lastCycleAt) return Infinity
  return Date.now() - config.lastCycleAt
}

function isScheduleEligible(projectId: string, schedule: DaemonProjectConfig['schedule']): boolean {
  const msSinceLast = msSinceLastCycle(projectId)
  switch (schedule) {
    case 'manual': return false
    case 'continuous': return msSinceLast >= MIN_COOLDOWN_MS
    case 'hourly': return msSinceLast >= 60 * 60 * 1000
    case 'nightly': {
      if (msSinceLast < 12 * 60 * 60 * 1000) return false
      const hour = new Date().getHours()
      return hour >= 23 || hour < 6
    }
  }
}

function goalsModifiedRecently(projectRoot: string, projectId: string): boolean {
  const config = getProjectConfig(projectId)
  if (!config.lastCycleAt) return false
  try {
    const mtime = statSync(join(projectRoot, 'GOALS.md')).mtimeMs
    return mtime > config.lastCycleAt
  } catch { return false }
}

export function scoreProjects(projects: Project[], activeChatProjectIds: ReadonlySet<string>): ProjectScore[] {
  return projects.map(project => {
    const config = getProjectConfig(project.id)

    if (!config.enabled) {
      return { project, score: -Infinity, eligible: false, skipReason: 'not enabled' }
    }
    if (activeChatProjectIds.has(project.id)) {
      return { project, score: -Infinity, eligible: false, skipReason: 'chat active on project' }
    }

    const cyclesToday = cyclesForProjectToday(project.path)
    const msSinceLast = msSinceLastCycle(project.id)

    if (cyclesToday >= HARD_CAP) {
      return { project, score: -Infinity, eligible: false, skipReason: 'hard cap reached' }
    }
    if (!isScheduleEligible(project.id, config.schedule)) {
      return { project, score: -Infinity, eligible: false, skipReason: `schedule '${config.schedule}' not met` }
    }

    let score = 0
    if (goalsModifiedRecently(project.path, project.id)) score += 10
    if (config.lastCycleOutcome === 'committed') score += 5
    score += (config.weight ?? 1.0) * 3
    if (cyclesToday >= SOFT_CAP) score -= 10
    score -= cyclesToday

    return { project, score, eligible: true }
  })
}

export function pickNextProject(projects: Project[], activeChatProjectIds: ReadonlySet<string>): Project | null {
  if (!getDaemonEnabled()) return null
  const scores = scoreProjects(projects, activeChatProjectIds)
  const eligible = scores.filter(s => s.eligible).sort((a, b) => b.score - a.score)
  return eligible[0]?.project ?? null
}
