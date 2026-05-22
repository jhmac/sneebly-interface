import keytar from 'keytar'
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device'
import { Octokit } from '@octokit/rest'

const SERVICE = 'sneebly-interface-github'
const ACCOUNT = 'oauth-token'

// Swap via env var; falls back to GitHub CLI's public client ID (read-only for their scopes,
// but valid for device-flow auth that returns a token usable for all repo scopes).
const CLIENT_ID = process.env['SNEEBLY_GITHUB_CLIENT_ID'] ?? '178c6fc778ccc68e1d6a'

// ── Token storage ──────────────────────────────────────────────────────────

export async function getStoredToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT)
}

export async function storeToken(token: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, token)
}

export async function clearToken(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT)
}

// ── Device flow ────────────────────────────────────────────────────────────

export async function startDeviceFlow(opts: {
  onUserCode: (code: string, verificationUri: string) => void
}): Promise<string> {
  const auth = createOAuthDeviceAuth({
    clientType: 'oauth-app',
    clientId: CLIENT_ID,
    scopes: ['repo', 'read:user', 'user:email'],
    onVerification: (verification) => {
      opts.onUserCode(verification.user_code, verification.verification_uri)
    },
  })

  const { token } = await auth({ type: 'oauth' })
  await storeToken(token)
  return token
}

// ── User info ──────────────────────────────────────────────────────────────

export interface GitHubUser {
  login: string
  avatarUrl: string
}

export async function getAuthenticatedUser(): Promise<GitHubUser | null> {
  const token = await getStoredToken()
  if (!token) return null
  try {
    const octokit = new Octokit({ auth: token })
    const { data } = await octokit.rest.users.getAuthenticated()
    return { login: data.login, avatarUrl: data.avatar_url }
  } catch {
    return null
  }
}

// ── Repo listing ───────────────────────────────────────────────────────────

export interface RepoInfo {
  id: number
  name: string
  fullName: string
  description: string | null
  defaultBranch: string
  private: boolean
  updatedAt: string
  cloneUrl: string
}

export async function listUserRepos(opts: {
  search?: string
  page: number
  perPage?: number
}): Promise<{ repos: RepoInfo[]; hasMore: boolean; totalCount: number }> {
  const token = await getStoredToken()
  if (!token) return { repos: [], hasMore: false, totalCount: 0 }

  const octokit = new Octokit({ auth: token })
  const perPage = opts.perPage ?? 30

  if (opts.search?.trim()) {
    const user = await getAuthenticatedUser()
    const q = `${opts.search} user:${user?.login ?? ''} in:name`
    const { data } = await octokit.rest.search.repos({
      q,
      sort: 'updated',
      order: 'desc',
      per_page: perPage,
      page: opts.page,
    })
    return {
      repos: data.items.map(toRepoInfo),
      hasMore: data.total_count > opts.page * perPage,
      totalCount: data.total_count,
    }
  }

  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: 'updated',
    direction: 'desc',
    per_page: perPage,
    page: opts.page,
  })
  return {
    repos: data.map(toRepoInfo),
    hasMore: data.length === perPage,
    totalCount: data.length + (opts.page - 1) * perPage,
  }
}

function toRepoInfo(r: {
  id: number
  name: string
  full_name: string
  description?: string | null
  default_branch: string
  private: boolean
  updated_at?: string | null
  clone_url: string
}): RepoInfo {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    description: r.description ?? null,
    defaultBranch: r.default_branch,
    private: r.private,
    updatedAt: r.updated_at ?? new Date().toISOString(),
    cloneUrl: r.clone_url,
  }
}
