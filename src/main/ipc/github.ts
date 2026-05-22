import { ipcMain, shell, BrowserWindow } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import simpleGit from 'simple-git'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { addProject, detectProjectName, listProjects } from '../services/project-registry'
import {
  getStoredToken, clearToken,
  startDeviceFlow, getAuthenticatedUser,
  listUserRepos,
} from '../services/github-auth'
import type { GitStatusResult, GitDiffResult, GitDiffFile } from '../../shared/types'

function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

function uniqueCloneDest(basePath: string, repoName: string): string {
  let dest = join(basePath, repoName)
  let n = 2
  while (existsSync(dest)) { dest = join(basePath, `${repoName}-${n++}`) }
  return dest
}

export function registerGitHubHandlers(): void {
  // ── Auth ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_AUTH_STATUS, async () => {
    const user = await getAuthenticatedUser()
    return user ? { connected: true, user } : { connected: false }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_START_OAUTH, async () => {
    try {
      await startDeviceFlow({
        onUserCode: (code, verificationUri) => {
          shell.openExternal(verificationUri)
          sendToAllWindows(IPC_CHANNELS.GITHUB_OAUTH_USER_CODE, { code, verificationUri })
        },
      })
      const user = await getAuthenticatedUser()
      return { success: true, user }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_DISCONNECT, async () => {
    await clearToken()
  })

  // ── Repos ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, async (
    _e,
    opts: { search?: string; page: number; perPage?: number }
  ) => {
    return listUserRepos(opts)
  })

  // ── Clone ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GITHUB_CLONE_REPO, async (
    _e,
    opts: { cloneUrl: string; fullName: string }
  ) => {
    const token = await getStoredToken()
    if (!token) return { error: 'Not authenticated with GitHub' }

    // Inject token for HTTPS auth
    const authedUrl = opts.cloneUrl.replace('https://', `https://x-access-token:${token}@`)

    // Destination: ~/SneeblyProjects/<repo-name>/
    const repoName = opts.fullName.split('/')[1] ?? opts.fullName
    const projectsBase = join(homedir(), 'SneeblyProjects')
    mkdirSync(projectsBase, { recursive: true })
    const dest = uniqueCloneDest(projectsBase, repoName)

    try {
      const git = simpleGit()
      await git.clone(authedUrl, dest)

      const name = detectProjectName(dest)
      const project = {
        id: crypto.randomUUID(),
        name,
        path: dest,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
      }
      addProject(project)
      return { projectId: project.id }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Git status ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GIT_GET_STATUS, async (
    _e,
    projectPath: string
  ): Promise<GitStatusResult> => {
    try {
      const git = simpleGit(projectPath)
      const [status, branchResult] = await Promise.all([
        git.status(),
        git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null),
      ])
      return {
        changedFiles: status.files.length,
        ahead: status.ahead,
        behind: status.behind,
        branch: branchResult?.trim() ?? null,
      }
    } catch {
      return { changedFiles: 0, ahead: 0, behind: 0, branch: null }
    }
  })

  // ── Git diff ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GIT_GET_DIFF, async (
    _e,
    projectPath: string
  ): Promise<GitDiffResult> => {
    try {
      const git = simpleGit(projectPath)
      const [status, diffResult] = await Promise.all([
        git.status(),
        git.diff(['HEAD']).catch(() => ''),
      ])

      // Parse per-file stats
      const diffStat = await git.diff(['HEAD', '--stat']).catch(() => '')
      const files: GitDiffFile[] = status.files.map((f) => {
        const statLine = diffStat.split('\n').find((l) => l.includes(f.path)) ?? ''
        const adds = parseInt(statLine.match(/(\d+) insertion/)?.[1] ?? '0', 10)
        const dels = parseInt(statLine.match(/(\d+) deletion/)?.[1] ?? '0', 10)
        const status_char =
          f.index === 'A' || f.working_dir === '?' ? 'A' :
          f.index === 'D' || f.working_dir === 'D' ? 'D' :
          f.index === 'R' ? 'R' : 'M'
        return { path: f.path, status: status_char as GitDiffFile['status'], additions: adds, deletions: dels }
      })

      // Include untracked files too (no diff, just listing)
      for (const f of status.not_added) {
        if (!files.find((x) => x.path === f)) {
          files.push({ path: f, status: '?', additions: 0, deletions: 0 })
        }
      }

      return { files, fullDiff: diffResult }
    } catch {
      return { files: [], fullDiff: '' }
    }
  })

  // ── Git commit + push ─────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT_AND_PUSH, async (
    _e,
    opts: { projectPath: string; files: string[]; message: string; body?: string; pushAfter: boolean }
  ) => {
    try {
      const git = simpleGit(opts.projectPath)
      await git.add(opts.files)

      const fullMessage = opts.body ? `${opts.message}\n\n${opts.body}` : opts.message
      await git.commit(fullMessage)
      const log = await git.log({ maxCount: 1 })
      const commitSha = log.latest?.hash ?? undefined

      if (opts.pushAfter) {
        // Inject token for HTTPS push if available
        const token = await getStoredToken()
        if (token) {
          const remotes = await git.getRemotes(true)
          const origin = remotes.find((r) => r.name === 'origin')
          if (origin?.refs?.push?.startsWith('https://github.com')) {
            const authedUrl = origin.refs.push.replace('https://', `https://x-access-token:${token}@`)
            await git.push(authedUrl, undefined)
          } else {
            await git.push()
          }
        } else {
          await git.push()
        }
        return { commitSha, pushed: true }
      }

      return { commitSha, pushed: false }
    } catch (err) {
      return { pushed: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
