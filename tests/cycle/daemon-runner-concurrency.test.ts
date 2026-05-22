import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CycleResult } from '../../src/shared/types'

vi.mock('../../src/main/services/project-registry', () => ({
  listProjects: () => [
    { id: 'proj-a', name: 'Project A', path: '/fake/a', addedAt: 0, lastOpenedAt: 0 },
    { id: 'proj-b', name: 'Project B', path: '/fake/b', addedAt: 0, lastOpenedAt: 0 },
  ],
}))

vi.mock('../../src/main/services/agent-session', () => ({
  getActiveChatProjectIds: () => new Set<string>(),
}))

vi.mock('../../src/main/services/cycle/cycle', () => ({
  runCycle: vi.fn(),
}))

vi.mock('../../src/main/services/cycle/scheduler', () => ({
  pickNextProject: vi.fn(() => null),
  getDaemonEnabled: vi.fn(() => false),
  getProjectConfig: vi.fn(() => ({ enabled: false, schedule: 'manual', weight: 1.0, lastCycleAt: null, lastCycleOutcome: null })),
  setProjectConfig: vi.fn(),
  recordCycleOutcome: vi.fn(),
}))

vi.mock('../../src/main/ipc/agent', () => ({
  pushAgentEvent: vi.fn(),
}))

import { runCycleNow } from '../../src/main/services/cycle/daemon-runner'
import { runCycle } from '../../src/main/services/cycle/cycle'

const mockedRunCycle = vi.mocked(runCycle)

describe('daemon-runner — concurrency guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('project B is rejected while project A is cycling', async () => {
    let resolveA!: (r: CycleResult) => void
    const slowCycleA = new Promise<CycleResult>((res) => { resolveA = res })
    mockedRunCycle.mockReturnValueOnce(slowCycleA)

    // Start A — don't await
    const cycleAPromise = runCycleNow('proj-a')

    // Immediately try B
    const resultB = await runCycleNow('proj-b')

    expect(resultB.outcome).toBe('failed')
    expect(resultB.error).toMatch(/already running/i)
    expect(mockedRunCycle).toHaveBeenCalledTimes(1)

    // Resolve A
    resolveA({ cycleId: 'a1', projectId: 'proj-a', outcome: 'committed', durationMs: 100 })
    const resultA = await cycleAPromise
    expect(resultA.outcome).toBe('committed')
  })

  it('project B runs after project A completes', async () => {
    const resultA: CycleResult = { cycleId: 'a1', projectId: 'proj-a', outcome: 'committed', durationMs: 100 }
    const resultB: CycleResult = { cycleId: 'b1', projectId: 'proj-b', outcome: 'committed', durationMs: 80 }

    mockedRunCycle
      .mockResolvedValueOnce(resultA)
      .mockResolvedValueOnce(resultB)

    const r1 = await runCycleNow('proj-a')
    expect(r1.outcome).toBe('committed')

    // A is done — B should succeed now
    const r2 = await runCycleNow('proj-b')
    expect(r2.outcome).toBe('committed')
    expect(mockedRunCycle).toHaveBeenCalledTimes(2)
  })
})
