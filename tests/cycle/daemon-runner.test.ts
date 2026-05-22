import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CycleResult } from '../../src/shared/types'

// Mock all external dependencies before importing daemon-runner
vi.mock('../../src/main/services/project-registry', () => ({
  listProjects: () => [{ id: 'test-proj', name: 'Test', path: '/fake/test', addedAt: 0, lastOpenedAt: 0 }],
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

import { runCycleNow, getDaemonStatus, startDaemon, stopDaemon } from '../../src/main/services/cycle/daemon-runner'
import { runCycle } from '../../src/main/services/cycle/cycle'

const mockedRunCycle = vi.mocked(runCycle)

describe('daemon-runner — runCycleNow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dryRun=true: returns dry-run outcome, never calls runCycle build phase', async () => {
    const dryRunResult: CycleResult = {
      cycleId: 'abc123',
      projectId: 'test-proj',
      outcome: 'dry-run',
      constraint: 'Add user auth',
      durationMs: 500,
    }
    mockedRunCycle.mockResolvedValueOnce(dryRunResult)

    const result = await runCycleNow('test-proj', { dryRun: true })

    expect(mockedRunCycle).toHaveBeenCalledOnce()
    expect(mockedRunCycle).toHaveBeenCalledWith('/fake/test', 'test-proj', { dryRun: true })
    expect(result.outcome).toBe('dry-run')
    expect(result.cycleId).toBe('abc123')
  })

  it('rejects concurrent cycles', async () => {
    // First cycle — never resolves during test
    let resolveFirst: (r: CycleResult) => void
    const firstPromise = new Promise<CycleResult>(resolve => { resolveFirst = resolve })
    mockedRunCycle.mockReturnValueOnce(firstPromise)

    // Start first cycle (don't await)
    const first = runCycleNow('test-proj')

    // Attempt second cycle immediately
    const second = await runCycleNow('test-proj')

    expect(second.outcome).toBe('failed')
    expect(second.error).toContain('already running')

    // Resolve the first cycle to clean up
    resolveFirst!({ cycleId: 'x', projectId: 'test-proj', outcome: 'committed', durationMs: 100 })
    await first
  })

  it('returns error result when project not found', async () => {
    const result = await runCycleNow('nonexistent-project-id')
    expect(result.outcome).toBe('failed')
    expect(result.error).toContain('not found')
  })
})

describe('daemon-runner — getDaemonStatus', () => {
  it('returns running=false when not started', () => {
    const status = getDaemonStatus()
    expect(status.running).toBe(false)
    expect(status.activeCycle).toBeNull()
  })
})

describe('daemon-runner — startDaemon', () => {
  afterEach(() => stopDaemon())

  it('does not start polling when flags are off', () => {
    // experimental and enabled are both false (via Store mock defaults)
    startDaemon()
    const status = getDaemonStatus()
    expect(status.running).toBe(false)
  })
})
