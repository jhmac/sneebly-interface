import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as keytarMock from '../__mocks__/keytar'

// ── Octokit mock ─────────────────────────────────────────────────────────────

const mockListForAuthenticatedUser = vi.fn()
const mockSearchRepos = vi.fn()
const mockGetAuthenticated = vi.fn()

vi.mock('@octokit/rest', () => {
  function Octokit() {
    return {
      rest: {
        repos: { listForAuthenticatedUser: mockListForAuthenticatedUser },
        search: { repos: mockSearchRepos },
        users: { getAuthenticated: mockGetAuthenticated },
      },
    }
  }
  return { Octokit }
})

import { listUserRepos } from '../../src/main/services/github-auth'

function makeRepo(overrides: Partial<{
  id: number; name: string; full_name: string; description: string | null
  default_branch: string; private: boolean; updated_at: string; clone_url: string
}> = {}) {
  return {
    id: 1,
    name: 'my-repo',
    full_name: 'user/my-repo',
    description: 'A test repo',
    default_branch: 'main',
    private: false,
    updated_at: '2024-01-01T00:00:00Z',
    clone_url: 'https://github.com/user/my-repo.git',
    ...overrides,
  }
}

beforeEach(() => {
  keytarMock.__reset()
  vi.clearAllMocks()
})

describe('listUserRepos', () => {
  it('returns empty result when no token stored', async () => {
    const result = await listUserRepos({ page: 1 })
    expect(result).toEqual({ repos: [], hasMore: false, totalCount: 0 })
  })

  it('returns repos from listForAuthenticatedUser', async () => {
    await keytarMock.setPassword('sneebly-interface-github', 'oauth-token', 'ghp_test')
    const repos = [makeRepo({ id: 1, name: 'repo-a' }), makeRepo({ id: 2, name: 'repo-b' })]
    mockListForAuthenticatedUser.mockResolvedValue({ data: repos })

    const result = await listUserRepos({ page: 1 })
    expect(result.repos).toHaveLength(2)
    expect(result.repos[0].name).toBe('repo-a')
    expect(result.repos[1].name).toBe('repo-b')
  })

  it('hasMore is true when a full page is returned', async () => {
    await keytarMock.setPassword('sneebly-interface-github', 'oauth-token', 'ghp_test')
    const repos = Array.from({ length: 30 }, (_, i) => makeRepo({ id: i, name: `repo-${i}` }))
    mockListForAuthenticatedUser.mockResolvedValue({ data: repos })

    const result = await listUserRepos({ page: 1, perPage: 30 })
    expect(result.hasMore).toBe(true)
  })

  it('hasMore is false when fewer than a full page is returned', async () => {
    await keytarMock.setPassword('sneebly-interface-github', 'oauth-token', 'ghp_test')
    mockListForAuthenticatedUser.mockResolvedValue({ data: [makeRepo()] })

    const result = await listUserRepos({ page: 1, perPage: 30 })
    expect(result.hasMore).toBe(false)
  })

  it('uses search API when query provided', async () => {
    await keytarMock.setPassword('sneebly-interface-github', 'oauth-token', 'ghp_test')
    mockGetAuthenticated.mockResolvedValue({ data: { login: 'testuser', avatar_url: '' } })
    mockSearchRepos.mockResolvedValue({
      data: { items: [makeRepo({ name: 'found-repo' })], total_count: 1 },
    })

    const result = await listUserRepos({ page: 1, search: 'found' })
    expect(mockSearchRepos).toHaveBeenCalledOnce()
    expect(mockListForAuthenticatedUser).not.toHaveBeenCalled()
    expect(result.repos[0].name).toBe('found-repo')
    expect(result.hasMore).toBe(false)
  })

  it('maps repo fields correctly', async () => {
    await keytarMock.setPassword('sneebly-interface-github', 'oauth-token', 'ghp_test')
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [makeRepo({ id: 42, name: 'my-repo', full_name: 'user/my-repo', private: true })],
    })

    const result = await listUserRepos({ page: 1 })
    const repo = result.repos[0]
    expect(repo.id).toBe(42)
    expect(repo.fullName).toBe('user/my-repo')
    expect(repo.private).toBe(true)
    expect(repo.cloneUrl).toBe('https://github.com/user/my-repo.git')
  })
})
