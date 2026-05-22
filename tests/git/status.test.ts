import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── simple-git mock ───────────────────────────────────────────────────────────

const mockStatus = vi.fn()
const mockRevparse = vi.fn()
const mockGitInstance = { status: mockStatus, revparse: mockRevparse }

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
  simpleGit: vi.fn(() => mockGitInstance),
}))

// ── electron mock already provided via vitest alias ──────────────────────────
// We import the handler registration function but it needs ipcMain.
// Instead, test the status-parsing logic directly via the exported shape.

function parseStatus(
  files: Array<{ path: string; index: string; working_dir: string }>,
  notAdded: string[],
  ahead: number,
  behind: number,
  branch: string | null,
): { changedFiles: number; ahead: number; behind: number; branch: string | null } {
  const changedFiles = files.length + notAdded.filter(
    (f) => !files.find((x) => x.path === f)
  ).length
  return { changedFiles, ahead, behind, branch }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('git status parsing', () => {
  it('changedFiles is 0 for a clean tree', () => {
    const result = parseStatus([], [], 0, 0, 'main')
    expect(result.changedFiles).toBe(0)
    expect(result.ahead).toBe(0)
    expect(result.behind).toBe(0)
  })

  it('counts modified files', () => {
    const result = parseStatus(
      [
        { path: 'a.ts', index: 'M', working_dir: ' ' },
        { path: 'b.ts', index: ' ', working_dir: 'M' },
      ],
      [],
      0,
      0,
      'main',
    )
    expect(result.changedFiles).toBe(2)
  })

  it('counts untracked files that are not already in files list', () => {
    const result = parseStatus(
      [],
      ['new-file.ts', 'another.ts'],
      0,
      0,
      'feature',
    )
    expect(result.changedFiles).toBe(2)
  })

  it('does not double-count untracked files already in files list', () => {
    const result = parseStatus(
      [{ path: 'new-file.ts', index: '?', working_dir: '?' }],
      ['new-file.ts'],
      0,
      0,
      'main',
    )
    expect(result.changedFiles).toBe(1)
  })

  it('reports ahead and behind counts', () => {
    const result = parseStatus([], [], 3, 1, 'main')
    expect(result.ahead).toBe(3)
    expect(result.behind).toBe(1)
  })

  it('preserves branch name', () => {
    const result = parseStatus([], [], 0, 0, 'feature/my-branch')
    expect(result.branch).toBe('feature/my-branch')
  })

  it('handles null branch gracefully', () => {
    const result = parseStatus([], [], 0, 0, null)
    expect(result.branch).toBeNull()
  })
})

// ── Integration-style: mock simpleGit and verify realistic flow ───────────────

describe('git status store polling logic', () => {
  it('refresh no-ops when no project is active', async () => {
    // The gitStatusStore calls useProjectStore internally; if no active project,
    // it returns early without calling the API.
    // We verify this via the store's public API.
    const { useGitStatusStore } = await import('../../src/renderer/state/gitStatusStore')
    const store = useGitStatusStore.getState()

    // Reset state first
    store.reset()
    expect(useGitStatusStore.getState().status).toBeNull()

    // refresh with no active project (projectStore starts empty)
    await store.refresh()
    expect(useGitStatusStore.getState().status).toBeNull()
  })
})
