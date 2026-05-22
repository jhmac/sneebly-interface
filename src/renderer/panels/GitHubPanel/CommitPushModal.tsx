import { useEffect, useRef, useState } from 'react'
import { X, GitCommit, Upload, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useGitStatusStore } from '../../state/gitStatusStore'
import type { GitDiffFile } from '../../../shared/types'

const STATUS_LABEL: Record<string, string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  '?': 'untracked',
}

const STATUS_COLOR: Record<string, string> = {
  M: 'text-amber-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-blue-400',
  '?': 'text-zinc-500',
}

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n').slice(0, 400)
  return (
    <div className="overflow-x-auto rounded bg-zinc-950 p-2 font-mono text-[10px] leading-4">
      {lines.map((line, i) => {
        const color =
          line.startsWith('+') && !line.startsWith('+++')
            ? 'text-green-400 bg-green-950/30'
            : line.startsWith('-') && !line.startsWith('---')
            ? 'text-red-400 bg-red-950/30'
            : line.startsWith('@@')
            ? 'text-blue-400'
            : 'text-zinc-500'
        return (
          <div key={i} className={`whitespace-pre ${color}`}>
            {line || ' '}
          </div>
        )
      })}
      {diff.split('\n').length > 400 && (
        <div className="mt-1 text-zinc-600">… truncated</div>
      )}
    </div>
  )
}

function FileRow({
  file,
  checked,
  onToggle,
  fileDiff,
}: {
  file: GitDiffFile
  checked: boolean
  onToggle: () => void
  fileDiff: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDiff = fileDiff.length > 0

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-3.5 w-3.5 accent-indigo-500 flex-shrink-0"
        />
        {hasDiff ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex flex-1 items-center gap-1.5 min-w-0 text-left"
          >
            {expanded
              ? <ChevronDown className="h-3 w-3 text-zinc-600 flex-shrink-0" />
              : <ChevronRight className="h-3 w-3 text-zinc-600 flex-shrink-0" />
            }
            <span className={`text-[10px] font-mono font-medium flex-shrink-0 ${STATUS_COLOR[file.status]}`}>
              {file.status}
            </span>
            <span className="text-xs text-zinc-300 truncate">{file.path}</span>
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-1.5 min-w-0">
            <span className="h-3 w-3 flex-shrink-0" />
            <span className={`text-[10px] font-mono font-medium flex-shrink-0 ${STATUS_COLOR[file.status]}`}>
              {file.status}
            </span>
            <span className="text-xs text-zinc-300 truncate">{file.path}</span>
          </div>
        )}
        <div className="flex-shrink-0 flex items-center gap-1.5 text-[10px]">
          {file.additions > 0 && <span className="text-green-500">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
          <span className="text-zinc-600">{STATUS_LABEL[file.status] ?? file.status}</span>
        </div>
      </div>
      {expanded && hasDiff && (
        <div className="border-t border-zinc-800 p-2">
          <DiffViewer diff={fileDiff} />
        </div>
      )}
    </div>
  )
}

function extractFileDiff(fullDiff: string, filePath: string): string {
  const marker = `diff --git`
  const lines = fullDiff.split('\n')
  let inFile = false
  const result: string[] = []

  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (line.includes(` b/${filePath}`)) {
        inFile = true
      } else if (inFile) {
        break
      }
    }
    if (inFile) result.push(line)
  }

  return result.join('\n')
}

export default function CommitPushModal({ onClose }: { onClose: () => void }) {
  const { activeProjectId, projects } = useProjectStore()
  const { refresh: refreshGitStatus } = useGitStatusStore()

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const [files, setFiles] = useState<GitDiffFile[]>([])
  const [fullDiff, setFullDiff] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!activeProject) return
    setLoading(true)
    window.api.gitGetDiff(activeProject.path).then((result) => {
      setFiles(result.files)
      setFullDiff(result.fullDiff)
      setSelected(new Set(result.files.map((f) => f.path)))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [activeProject?.path])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [loading])

  function toggleFile(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === files.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(files.map((f) => f.path)))
    }
  }

  async function handleCommit(pushAfter: boolean) {
    if (!activeProject || !message.trim() || selected.size === 0) return
    setCommitting(true)
    setError(null)
    try {
      const result = await window.api.gitCommitAndPush({
        projectPath: activeProject.path,
        files: [...selected],
        message: message.trim(),
        pushAfter,
      })
      if (result.error) {
        setError(result.error)
        setCommitting(false)
        return
      }
      await refreshGitStatus()
      setDone(pushAfter ? 'Committed and pushed.' : `Committed${result.commitSha ? ` (${result.commitSha.slice(0, 7)})` : ''}.`)
      setTimeout(onClose, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCommitting(false)
    }
  }

  const canCommit = message.trim().length > 0 && selected.size > 0 && !committing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[680px] max-h-[85vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Commit changes</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {loading ? (
            <p className="py-8 text-center text-xs text-zinc-600">Loading changes…</p>
          ) : files.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">No changes to commit</p>
          ) : (
            <>
              {/* Commit message */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Commit message
                </label>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your changes…"
                  rows={2}
                  className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
                />
              </div>

              {/* File list */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Files ({selected.size} / {files.length} selected)
                  </label>
                  <button
                    onClick={toggleAll}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {selected.size === files.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {files.map((f) => (
                    <FileRow
                      key={f.path}
                      file={f}
                      checked={selected.has(f.path)}
                      onToggle={() => toggleFile(f.path)}
                      fileDiff={extractFileDiff(fullDiff, f.path)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="rounded-md border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {done && (
            <p className="rounded-md border border-green-800 bg-green-950 px-3 py-2 text-xs text-green-300">
              {done}
            </p>
          )}
        </div>

        {/* Footer */}
        {!loading && files.length > 0 && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleCommit(false)}
              disabled={!canCommit}
              className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-600 disabled:opacity-50"
            >
              <GitCommit className="h-3.5 w-3.5" />
              Commit
            </button>
            <button
              onClick={() => handleCommit(true)}
              disabled={!canCommit}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Commit & Push
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
