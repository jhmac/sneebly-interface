import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Project } from '../../src/shared/types'
import Store from 'electron-store'

// Mock journal before importing scheduler
vi.mock('../../src/main/services/cycle/journal', () => ({
  readJournal: () => [],
}))

import { scoreProjects, pickNextProject } from '../../src/main/services/cycle/scheduler'

const ONE_HOUR_AGO = Date.now() - 60 * 60 * 1000

const makeProject = (id: string, path = `/fake/projects/${id}`): Project => ({
  id,
  name: id,
  path,
  addedAt: Date.now(),
  lastOpenedAt: Date.now(),
})

function setConfig(id: string, cfg: object): void {
  new Store().set(`daemon.projects.${id}`, cfg)
}

describe('scoreProjects', () => {
  beforeEach(() => {
    Store._reset()
    new Store().set('daemon.enabled', true)
  })

  it('scores projects — higher weight means higher score', () => {
    setConfig('high', { enabled: true, schedule: 'continuous', weight: 3.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })
    setConfig('med',  { enabled: true, schedule: 'continuous', weight: 1.5, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })
    setConfig('low',  { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })

    const projects = [makeProject('high'), makeProject('med'), makeProject('low')]
    const scores = scoreProjects(projects, new Set())
    const byId = Object.fromEntries(scores.map(s => [s.project.id, s]))

    expect(byId['high']!.score).toBeGreaterThan(byId['med']!.score)
    expect(byId['med']!.score).toBeGreaterThan(byId['low']!.score)
  })

  it('marks projects with active chat as ineligible', () => {
    setConfig('alpha', { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })
    setConfig('beta',  { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })

    const projects = [makeProject('alpha'), makeProject('beta')]
    const chatActive = new Set(['alpha'])
    const scores = scoreProjects(projects, chatActive)
    const alpha = scores.find(s => s.project.id === 'alpha')!
    const beta  = scores.find(s => s.project.id === 'beta')!

    expect(alpha.eligible).toBe(false)
    expect(alpha.skipReason).toContain('chat active')
    expect(beta.eligible).toBe(true)
  })

  it('marks not-enabled projects as ineligible', () => {
    setConfig('x', { enabled: false, schedule: 'continuous', weight: 1.0, lastCycleAt: null, lastCycleOutcome: null })
    const projects = [makeProject('x')]
    const scores = scoreProjects(projects, new Set())
    expect(scores[0]!.eligible).toBe(false)
    expect(scores[0]!.skipReason).toBe('not enabled')
  })
})

describe('pickNextProject', () => {
  beforeEach(() => {
    Store._reset()
  })

  it('returns null when daemon is disabled', () => {
    new Store().set('daemon.enabled', false)
    const result = pickNextProject([makeProject('a')], new Set())
    expect(result).toBeNull()
  })

  it('returns highest-scoring eligible project', () => {
    new Store().set('daemon.enabled', true)
    setConfig('winner', { enabled: true, schedule: 'continuous', weight: 5.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })
    setConfig('loser',  { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })
    setConfig('meh',    { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })

    const projects = [makeProject('loser'), makeProject('winner'), makeProject('meh')]
    const result = pickNextProject(projects, new Set())
    expect(result?.id).toBe('winner')
  })

  it('returns null when all projects are in chat', () => {
    new Store().set('daemon.enabled', true)
    setConfig('a', { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })
    setConfig('b', { enabled: true, schedule: 'continuous', weight: 1.0, lastCycleAt: ONE_HOUR_AGO, lastCycleOutcome: null })

    const projects = [makeProject('a'), makeProject('b')]
    const result = pickNextProject(projects, new Set(['a', 'b']))
    expect(result).toBeNull()
  })
})
