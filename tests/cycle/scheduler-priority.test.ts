import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '../../src/shared/types'

// Mock electron-store so getDaemonEnabled reads from our controlled store
let storeData: Record<string, unknown> = {}
vi.mock('electron-store', () => ({
  default: class {
    get(key: string, def?: unknown) { return storeData[key] ?? def }
    set(key: string, val: unknown) { storeData[key] = val }
  },
}))

// journal reads (cyclesForProjectToday) — return 0 cycles today
vi.mock('../../src/main/services/cycle/journal', () => ({
  readJournal: vi.fn(() => []),
}))

import { pickNextProject, scoreProjects, setProjectConfig } from '../../src/main/services/cycle/scheduler'

const projects: Project[] = [
  { id: 'low-proj', name: 'Low', path: '/fake/low', addedAt: 0, lastOpenedAt: 0 },
  { id: 'high-proj', name: 'High', path: '/fake/high', addedAt: 0, lastOpenedAt: 0 },
]

beforeEach(() => {
  storeData = { 'daemon.enabled': true }
  // Configure projects
  storeData['daemon.projects.low-proj'] = { enabled: true, schedule: 'continuous', weight: 0.5, lastCycleAt: null, lastCycleOutcome: null }
  storeData['daemon.projects.high-proj'] = { enabled: true, schedule: 'continuous', weight: 4.0, lastCycleAt: null, lastCycleOutcome: null }
})

describe('scheduler — priority ordering', () => {
  it('highest-weight project is picked first', () => {
    const next = pickNextProject(projects, new Set())
    expect(next?.id).toBe('high-proj')
  })

  it('scoreProjects ranks high-weight project higher', () => {
    const scores = scoreProjects(projects, new Set())
    const lowScore = scores.find(s => s.project.id === 'low-proj')!
    const highScore = scores.find(s => s.project.id === 'high-proj')!
    expect(highScore.score).toBeGreaterThan(lowScore.score)
    expect(highScore.eligible).toBe(true)
    expect(lowScore.eligible).toBe(true)
  })

  it('disabled project is ineligible regardless of weight', () => {
    storeData['daemon.projects.high-proj'] = { enabled: false, schedule: 'continuous', weight: 4.0, lastCycleAt: null, lastCycleOutcome: null }
    const scores = scoreProjects(projects, new Set())
    const highScore = scores.find(s => s.project.id === 'high-proj')!
    expect(highScore.eligible).toBe(false)
  })

  it('returns null when daemon is globally disabled', () => {
    storeData['daemon.enabled'] = false
    const next = pickNextProject(projects, new Set())
    expect(next).toBeNull()
  })
})
