import { useEffect, useState } from 'react'
import { X, FileText } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import type { QueueItem } from '../../../shared/types'

// ── Diff viewer ────────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = diff.split('\n')
  const TRUNCATE_AT = 500
  const truncated = lines.length > TRUNCATE_AT
  const displayLines = truncated && !expanded ? lines.slice(0, TRUNCATE_AT) : lines

  return (
    <div className="overflow-hidden rounded border border-zinc-800 bg-zinc-950 font-mono text-[11px]">
      <div className="max-h-64 overflow-y-auto">
        {displayLines.map((line, i) => (
          <div
            key={i}
            className={[
              'px-3 py-px leading-5 whitespace-pre',
              line.startsWith('+') && !line.startsWith('+++')
                ? 'bg-green-950/40 text-green-300'
                : line.startsWith('-') && !line.startsWith('---')
                ? 'bg-red-950/40 text-red-300'
                : line.startsWith('@@')
                ? 'text-blue-400'
                : 'text-zinc-400',
            ].join(' ')}
          >
            {line || ' '}
          </div>
        ))}
      </div>
      {truncated && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full border-t border-zinc-800 px-3 py-1.5 text-left text-xs text-indigo-400 hover:bg-zinc-900"
        >
          Show full diff ({lines.length - TRUNCATE_AT} more lines)
        </button>
      )}
    </div>
  )
}

// ── Conflict modal ─────────────────────────────────────────────────────────

function ConflictModal({
  conflicts,
  diffPath,
  onReject,
  onCancel,
}: {
  conflicts: string
  diffPath: string
  onReject: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="flex w-[560px] max-h-[80vh] flex-col gap-4 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <p className="text-sm font-medium text-zinc-200">Cannot apply cleanly</p>
        <p className="text-xs text-zinc-400">
          Files have changed since this was queued. Resolve the conflict manually:
        </p>
        <ol className="ml-4 list-decimal text-xs text-zinc-400 space-y-0.5">
          <li>Open the diff file in your editor</li>
          <li>Apply the changes that still make sense</li>
          <li>Reject this queue item once resolved</li>
        </ol>
        <pre className="max-h-40 overflow-y-auto rounded bg-zinc-950 p-3 text-[10px] text-red-300 whitespace-pre-wrap">
          {conflicts.slice(0, 2000)}{conflicts.length > 2000 ? '\n…(truncated)' : ''}
        </pre>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => window.api.shellOpenExternal(`file://${diffPath}`)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Open diff in editor
          </button>
          <button
            onClick={onReject}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors"
          >
            Reject as stale
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm reject dialog ──────────────────────────────────────────────────

function RejectConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="flex w-80 flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <p className="text-sm text-zinc-200">Reject this queued cycle?</p>
        <p className="text-xs text-zinc-500">The diff will be discarded.</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Queue item card ────────────────────────────────────────────────────────

function QueueCard({
  item,
  projectId,
  projectPath,
  onDone,
}: {
  item: QueueItem
  projectId: string
  projectPath: string
  onDone: () => void
}) {
  const [diff, setDiff] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [rejectConfirm, setRejectConfirm] = useState(false)
  const [conflict, setConflict] = useState<{ text: string; diffPath: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const diffPath = `${projectPath}/.sneebly/queue/pending-${item.cycleId}.diff`

  useEffect(() => {
    window.api.daemonReadQueueDiff(projectId, item.cycleId).then(setDiff)
  }, [projectId, item.cycleId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleApprove() {
    setApproving(true)
    try {
      const result = await window.api.daemonQueueApprove(projectId, item.cycleId)
      if (result.success) {
        showToast('Approved and pushed')
        setTimeout(onDone, 600)
      } else {
        setConflict({ text: result.conflicts ?? 'Unknown conflict', diffPath })
      }
    } finally {
      setApproving(false)
    }
  }

  async function handleReject() {
    await window.api.daemonQueueReject(projectId, item.cycleId)
    onDone()
  }

  const relTs = new Date(item.ts).toLocaleString()

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-zinc-200">{item.constraint}</p>
          <p className="text-xs text-zinc-500">{item.cycleId} · {relTs}</p>
          {item.reason && <p className="mt-0.5 text-xs text-zinc-400">{item.reason}</p>}
        </div>
      </div>

      {diff === null ? (
        <p className="text-xs text-zinc-600">Loading diff…</p>
      ) : diff === '' ? (
        <p className="text-xs text-zinc-600">Diff file not found</p>
      ) : (
        <DiffViewer diff={diff} />
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => window.api.shellOpenExternal(`file://${diffPath}`)}
          className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          Open in editor
        </button>
        <button
          onClick={() => setRejectConfirm(true)}
          className="rounded border border-red-900 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950 hover:text-red-300 transition-colors"
        >
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={approving}
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {approving ? 'Applying…' : 'Approve'}
        </button>
      </div>

      {toast && (
        <p className="text-xs text-green-400">{toast}</p>
      )}

      {rejectConfirm && (
        <RejectConfirm
          onConfirm={() => { setRejectConfirm(false); handleReject() }}
          onCancel={() => setRejectConfirm(false)}
        />
      )}

      {conflict && (
        <ConflictModal
          conflicts={conflict.text}
          diffPath={conflict.diffPath}
          onReject={() => { setConflict(null); handleReject() }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────

export default function DaemonQueueModal({ onClose }: { onClose: () => void }) {
  const { projects, activeProjectId } = useProjectStore()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  async function loadQueue() {
    if (!activeProjectId) { setLoading(false); return }
    setLoading(true)
    try {
      setQueue(await window.api.daemonListQueue(activeProjectId))
    } catch {
      setQueue([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadQueue() }, [activeProjectId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[680px] max-h-[90vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Queue Approval</h2>
            {activeProject && (
              <p className="text-xs text-zinc-500 mt-0.5">{activeProject.name}</p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-center text-xs text-zinc-600 py-8">Loading…</p>
          ) : queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-zinc-600">
              <FileText className="h-8 w-8" />
              <p className="text-sm">No pending approvals</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {queue.map((item) => (
                <QueueCard
                  key={item.cycleId}
                  item={item}
                  projectId={activeProjectId ?? ''}
                  projectPath={activeProject?.path ?? ''}
                  onDone={loadQueue}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
