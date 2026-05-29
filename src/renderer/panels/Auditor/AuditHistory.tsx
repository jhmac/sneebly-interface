import { useEffect } from 'react'
import { X, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { useAuditorStore } from '../../state/auditorStore'
import { useProjectStore } from '../../state/projectStore'
import type { AuditStatus } from '../../../shared/types'

const STATUS_ICON: Record<AuditStatus, React.ElementType> = {
  completed: CheckCircle,
  canceled: XCircle,
  failed: AlertCircle,
  running: Clock,
  pending: Clock,
  'awaiting-budget-decision': Clock,
  'paused-rate-limit': Clock,
}

const STATUS_COLOR: Record<AuditStatus, string> = {
  completed: 'text-green-400',
  canceled: 'text-zinc-500',
  failed: 'text-red-400',
  running: 'text-indigo-400',
  pending: 'text-zinc-500',
  'awaiting-budget-decision': 'text-amber-400',
  'paused-rate-limit': 'text-amber-400',
}

export default function AuditHistory() {
  const {
    historyOpen, closeHistory, history, historyLoading, setHistory, setHistoryLoading,
    openBrowser, setFindings, activeAuditId,
  } = useAuditorStore()
  const { activeProjectId } = useProjectStore()

  useEffect(() => {
    if (!historyOpen || !activeProjectId) return
    setHistoryLoading(true)
    window.api.auditList(activeProjectId).then((list) => {
      setHistory(list)
    }).catch(console.error).finally(() => setHistoryLoading(false))
  }, [historyOpen, activeProjectId])

  if (!historyOpen) return null

  async function handleOpen(auditId: string) {
    if (!activeProjectId) return
    openBrowser(auditId)
    const result = await window.api.auditGet(auditId, activeProjectId)
    if (result) setFindings(result.findings)
    closeHistory()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
      <div className="flex w-[600px] max-h-[80vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Audit History</h2>
          <button onClick={closeHistory} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {historyLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-600">Loading…</div>
          ) : history.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
              No audits run yet for this project.
            </div>
          ) : (
            history.map((entry) => {
              const StatusIcon = STATUS_ICON[entry.status]
              const colorCls = STATUS_COLOR[entry.status]
              const date = new Date(entry.startedAt).toLocaleString()
              const isActive = entry.id === activeAuditId

              return (
                <button
                  key={entry.id}
                  onClick={() => handleOpen(entry.id)}
                  className="flex w-full items-center gap-4 border-b border-zinc-800 px-5 py-3 text-left hover:bg-zinc-900 transition-colors"
                >
                  <StatusIcon className={`h-4 w-4 flex-shrink-0 ${colorCls}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-zinc-200">{date}</p>
                      <span className={`text-[10px] ${colorCls}`}>{entry.status}</span>
                      <span className="text-[10px] text-zinc-600">{entry.mode}</span>
                      {isActive && <span className="text-[9px] text-indigo-400 bg-indigo-900/30 rounded px-1">active</span>}
                    </div>
                    <div className="mt-0.5 flex gap-3 text-[10px] text-zinc-500">
                      <span>{entry.totalFiles} files</span>
                      <span>{entry.findingCount} findings</span>
                      {entry.bySeverity.critical > 0 && (
                        <span className="text-red-400">{entry.bySeverity.critical} critical</span>
                      )}
                      <span>${entry.costActualUsd.toFixed(3)}</span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
