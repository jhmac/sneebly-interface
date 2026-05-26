import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project, ReviewOutput } from '../../src/shared/types'

// Mock the event stream so we can assert the review_agent_fix_addressed event without disk IO.
const appendEvent = vi.fn()
vi.mock('../../src/main/services/event-stream', () => ({
  appendEvent: (...args: unknown[]) => appendEvent(...args),
  readEventsForDateRange: () => [],
}))

import {
  parseCommitHashes,
  isFixExpired,
  resolveFixOutcome,
  beginFixTracking,
  handleTurnEndForFix,
  handleReviewDoneForFix,
  __getPendingFix,
  __resetFixTracking,
  type FixTrackingDeps,
} from '../../src/main/services/review-agent'

const PROJECT_PATH = '/tmp/fix-tracking-proj'
const COMPLETE: ReviewOutput = {
  verdict: 'complete', confidence: 'high', eightLensFindings: [], specMatch: [],
  recommendedAction: { type: 'accept', reason: 'ok' }, nonBlockingObservations: [], uncertaintyFlags: [],
}
const PARTIAL: ReviewOutput = { ...COMPLETE, verdict: 'partial' }

let nowValue = 1_000_000

function makeDeps(over: Partial<FixTrackingDeps> = {}): FixTrackingDeps {
  return {
    listProjects: () => [{ id: 'p1', name: 'P1', path: PROJECT_PATH } as unknown as Project],
    emitFixState: vi.fn(),
    gitRevParseHead: vi.fn().mockResolvedValue('HEAD0'),
    gitLogSince: vi.fn().mockResolvedValue([]),
    fireFixReview: vi.fn().mockReturnValue('rev-turn-1'),
    now: () => nowValue,
    ...over,
  }
}

beforeEach(() => {
  __resetFixTracking()
  appendEvent.mockClear()
  nowValue = 1_000_000
})

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('fix-tracking — pure helpers', () => {
  it('parseCommitHashes splits non-empty output, drops blanks', () => {
    expect(parseCommitHashes('')).toEqual([])
    expect(parseCommitHashes('   \n  ')).toEqual([])
    expect(parseCommitHashes('a1\nb2\n')).toEqual(['a1', 'b2'])
  })

  it('isFixExpired is true past the 30-minute window', () => {
    const start = 0
    expect(isFixExpired(start, 29 * 60 * 1000)).toBe(false)
    expect(isFixExpired(start, 31 * 60 * 1000)).toBe(true)
  })

  it('resolveFixOutcome is fixed only on a clean verdict with no error', () => {
    expect(resolveFixOutcome(COMPLETE, undefined)).toBe('fixed')
    expect(resolveFixOutcome(PARTIAL, undefined)).toBe('cleared')
    expect(resolveFixOutcome(COMPLETE, 'boom')).toBe('cleared')
    expect(resolveFixOutcome(undefined, undefined)).toBe('cleared')
  })
})

// ── beginFixTracking ────────────────────────────────────────────────────────────

describe('fix-tracking — beginFixTracking', () => {
  it('records HEAD as sinceCommit and emits "fixing"', async () => {
    const deps = makeDeps({ gitRevParseHead: vi.fn().mockResolvedValue('abc123') })
    await beginFixTracking('p1', 'm1', 'rev-0', deps)

    const entry = __getPendingFix('p1', 'm1')
    expect(entry).toMatchObject({ fromReviewId: 'rev-0', sinceCommit: 'abc123', verifying: false })
    expect(deps.emitFixState).toHaveBeenCalledWith('p1', 'm1', 'fixing')
  })

  it('does nothing when the project is not a git repo (rev-parse throws)', async () => {
    const deps = makeDeps({ gitRevParseHead: vi.fn().mockRejectedValue(new Error('not a repo')) })
    await beginFixTracking('p1', 'm1', 'rev-0', deps)
    expect(__getPendingFix('p1', 'm1')).toBeUndefined()
    expect(deps.emitFixState).not.toHaveBeenCalled()
  })
})

// ── handleTurnEndForFix ─────────────────────────────────────────────────────────

describe('fix-tracking — handleTurnEndForFix', () => {
  it('leaves the pendingFix in place when no new commits landed', async () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockResolvedValue([]) })
    await beginFixTracking('p1', 'm1', 'rev-0', deps)
    ;(deps.emitFixState as ReturnType<typeof vi.fn>).mockClear()

    await handleTurnEndForFix('p1', deps)

    expect(deps.fireFixReview).not.toHaveBeenCalled()
    expect(deps.emitFixState).not.toHaveBeenCalled()
    expect(__getPendingFix('p1', 'm1')).toBeDefined()
  })

  it('fires a re-review and emits "verifying" when new commits exist', async () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockResolvedValue(['c1']) })
    await beginFixTracking('p1', 'm1', 'rev-0', deps)

    await handleTurnEndForFix('p1', deps)

    expect(deps.fireFixReview).toHaveBeenCalledWith('p1', 'm1')
    expect(deps.emitFixState).toHaveBeenCalledWith('p1', 'm1', 'verifying')
    expect(__getPendingFix('p1', 'm1')?.verifying).toBe(true)
  })

  it('does not stack a second re-review while one is already verifying', async () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockResolvedValue(['c1']) })
    await beginFixTracking('p1', 'm1', 'rev-0', deps)
    await handleTurnEndForFix('p1', deps) // fires once, sets verifying
    await handleTurnEndForFix('p1', deps) // should be skipped

    expect(deps.fireFixReview).toHaveBeenCalledTimes(1)
  })

  it('drops an expired pendingFix and emits "cleared" on a later turn-end', async () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockResolvedValue(['c1']) })
    await beginFixTracking('p1', 'm1', 'rev-0', deps) // startedAt = nowValue
    nowValue += 31 * 60 * 1000

    await handleTurnEndForFix('p1', deps)

    expect(__getPendingFix('p1', 'm1')).toBeUndefined()
    expect(deps.emitFixState).toHaveBeenLastCalledWith('p1', 'm1', 'cleared')
    expect(deps.fireFixReview).not.toHaveBeenCalled()
  })

  it('backstop timer reverts the chip after the timeout with no turn-end at all', async () => {
    vi.useFakeTimers()
    try {
      const deps = makeDeps()
      await beginFixTracking('p1', 'm1', 'rev-0', deps)
      expect(__getPendingFix('p1', 'm1')).toBeDefined()

      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

      expect(__getPendingFix('p1', 'm1')).toBeUndefined()
      expect(deps.emitFixState).toHaveBeenLastCalledWith('p1', 'm1', 'cleared')
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles two milestones in the same project independently', async () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockResolvedValue(['c1']) })
    await beginFixTracking('p1', 'm1', 'rev-a', deps)
    await beginFixTracking('p1', 'm2', 'rev-b', deps)

    await handleTurnEndForFix('p1', deps)

    expect(deps.fireFixReview).toHaveBeenCalledWith('p1', 'm1')
    expect(deps.fireFixReview).toHaveBeenCalledWith('p1', 'm2')
    expect(deps.fireFixReview).toHaveBeenCalledTimes(2)
  })

  it('clears the entry if the Review Agent is disabled when the commit lands', async () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockResolvedValue(['c1']),
      fireFixReview: vi.fn().mockReturnValue(null), // disabled / gated off
    })
    await beginFixTracking('p1', 'm1', 'rev-0', deps)
    await handleTurnEndForFix('p1', deps)

    expect(deps.emitFixState).toHaveBeenLastCalledWith('p1', 'm1', 'cleared')
    expect(__getPendingFix('p1', 'm1')).toBeUndefined()
  })
})

// ── handleReviewDoneForFix ──────────────────────────────────────────────────────

describe('fix-tracking — handleReviewDoneForFix', () => {
  it('partial → complete: emits "fixed", logs the event, deletes the entry', async () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockResolvedValue(['c1', 'c2']) })
    await beginFixTracking('p1', 'm1', 'prev-review', deps)

    await handleReviewDoneForFix('p1', 'm1', 'new-review', COMPLETE, undefined, deps)

    expect(deps.emitFixState).toHaveBeenLastCalledWith('p1', 'm1', 'fixed')
    expect(__getPendingFix('p1', 'm1')).toBeUndefined()
    const semantic = appendEvent.mock.calls.at(-1)?.[2] as { kind: string; payload: Record<string, unknown> }
    expect(semantic.kind).toBe('review_agent_fix_addressed')
    expect(semantic.payload).toMatchObject({
      milestoneId: 'm1', previousReviewId: 'prev-review', newReviewId: 'new-review', fixCommitsCount: 2,
    })
  })

  it('still partial: emits "cleared", no event, deletes the entry', async () => {
    const deps = makeDeps()
    await beginFixTracking('p1', 'm1', 'prev-review', deps)

    await handleReviewDoneForFix('p1', 'm1', 'new-review', PARTIAL, undefined, deps)

    expect(deps.emitFixState).toHaveBeenLastCalledWith('p1', 'm1', 'cleared')
    expect(__getPendingFix('p1', 'm1')).toBeUndefined()
    expect(appendEvent).not.toHaveBeenCalled()
  })

  it('is a no-op when no fix cycle is tracked (normal review)', async () => {
    const deps = makeDeps()
    await handleReviewDoneForFix('p1', 'm1', 'new-review', COMPLETE, undefined, deps)
    expect(deps.emitFixState).not.toHaveBeenCalled()
    expect(appendEvent).not.toHaveBeenCalled()
  })

  it('re-review error: emits "cleared", deletes the entry', async () => {
    const deps = makeDeps()
    await beginFixTracking('p1', 'm1', 'prev-review', deps)

    await handleReviewDoneForFix('p1', 'm1', 'new-review', undefined, 'spawn failed', deps)

    expect(deps.emitFixState).toHaveBeenLastCalledWith('p1', 'm1', 'cleared')
    expect(__getPendingFix('p1', 'm1')).toBeUndefined()
  })
})
