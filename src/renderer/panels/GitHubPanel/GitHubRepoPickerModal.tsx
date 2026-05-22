import { useEffect, useRef, useState } from 'react'
import { X, Lock, Globe, Search, GitBranch } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import type { GitHubRepo } from '../../../shared/types'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success' }: { message: string; type?: 'success' | 'error' }) {
  return (
    <div className={[
      'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-lg border px-4 py-2 text-sm shadow-xl',
      type === 'success'
        ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
        : 'bg-red-950 border-red-800 text-red-200',
    ].join(' ')}>
      {message}
    </div>
  )
}

// ── Repo card ──────────────────────────────────────────────────────────────

function RepoCard({
  repo,
  onCloned,
}: {
  repo: GitHubRepo
  onCloned: (projectId: string) => void
}) {
  const [cloning, setCloning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [openAfter, setOpenAfter] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function handleClone() {
    setCloning(true)
    setProgress('Cloning…')
    setError(null)
    try {
      const result = await window.api.githubCloneRepo({
        cloneUrl: repo.cloneUrl,
        fullName: repo.fullName,
      })
      if (result.error) {
        setError(result.error)
        setCloning(false)
        setProgress(null)
        return
      }
      setProgress('Done')
      if (openAfter && result.projectId) {
        onCloned(result.projectId)
      } else {
        // Reload project list without switching
        await useProjectStore.getState().loadProjects()
        setCloning(false)
        setProgress('Added to project list')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCloning(false)
      setProgress(null)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-zinc-100 truncate">{repo.name}</span>
            {repo.private
              ? <Lock className="h-3 w-3 flex-shrink-0 text-zinc-500" />
              : <Globe className="h-3 w-3 flex-shrink-0 text-zinc-600" />
            }
          </div>
          <p className="text-[11px] text-zinc-500">{repo.fullName.split('/')[0]}</p>
          {repo.description && (
            <p className="mt-1 text-xs text-zinc-400 line-clamp-2">{repo.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-600">
            <span className="flex items-center gap-0.5">
              <GitBranch className="h-2.5 w-2.5" />
              {repo.defaultBranch}
            </span>
            <span>·</span>
            <span>Updated {relativeTime(repo.updatedAt)}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer">
              <input
                type="checkbox"
                checked={openAfter}
                onChange={(e) => setOpenAfter(e.target.checked)}
                className="h-3 w-3 accent-indigo-500"
              />
              Open after
            </label>
            <button
              onClick={handleClone}
              disabled={cloning}
              className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {cloning ? progress ?? 'Cloning…' : 'Clone'}
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400 max-w-[200px] text-right">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────

export default function GitHubRepoPickerModal({ onClose }: { onClose: () => void }) {
  const { requestProjectSwitch } = useProjectStore()
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function load(search: string, pg: number, append = false) {
    setLoading(true)
    try {
      const result = await window.api.githubListRepos({ search: search || undefined, page: pg })
      setRepos((prev) => append ? [...prev, ...result.repos] : result.repos)
      setHasMore(result.hasMore)
      setPage(pg)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load repos', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load('', 1) }, [])

  function handleSearchChange(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(val, 1), 300)
  }

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleCloned(projectId: string) {
    // Reload projects and switch to cloned project
    await useProjectStore.getState().loadProjects()
    await requestProjectSwitch(projectId)
    onClose()
    showToast(`Cloned successfully. Welcome to Sneebly.`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[640px] max-h-[90vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Clone a repository</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="flex-shrink-0 border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search your repositories…"
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && repos.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">Loading…</p>
          ) : repos.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">No repositories found</p>
          ) : (
            <div className="flex flex-col gap-2">
              {repos.map((repo) => (
                <RepoCard key={repo.id} repo={repo} onCloned={handleCloned} />
              ))}
              {hasMore && (
                <button
                  onClick={() => load(query, page + 1, true)}
                  disabled={loading}
                  className="w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300 disabled:opacity-50"
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  )
}
