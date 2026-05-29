import { X, Loader, DollarSign, AlertTriangle } from 'lucide-react'
import { useAuditorStore } from '../../state/auditorStore'
import { useProjectStore } from '../../state/projectStore'

const PHASE_NAMES: Record<number, string> = {
  1: 'Discovery',
  2: 'Code Review',
  3: 'Security Scan',
  4: 'Schema Review',
  5: 'Convention Check',
  6: 'Dep Security / Env / TODO',
  7: 'Synthesis',
}

// The orchestrator sends this message substring when the cost cap is hit
const COST_CAP_MESSAGE = 'Cost cap reached'

export default function AuditProgressPanel() {
  const { activeAuditId, activeProgress, clearActiveAudit, openBrowser, setFindings } = useAuditorStore()
  const { activeProjectId } = useProjectStore()

  if (!activeAuditId || !activeProgress) return null

  const { phase, totalProcessed, totalFiles, findingsAccumulated, bySeverity,
    estimatedRemainingMs, currentSpendUsd, estimatedTotalUsd, message } = activeProgress

  const isCostCapPaused = message?.includes(COST_CAP_MESSAGE) ?? false

  const pct = totalFiles > 0 ? Math.round((totalProcessed / totalFiles) * 100) : 0
  const remainSec = Math.ceil(estimatedRemainingMs / 1000)
  const remainStr = remainSec > 60
    ? `~${Math.ceil(remainSec / 60)}m`
    : remainSec > 0 ? `~${remainSec}s` : ''

  async function handleCancel() {
    if (!activeAuditId) return
    await window.api.auditCancel(activeAuditId, activeProjectId ?? undefined)
    clearActiveAudit()
  }

  async function handleContinue() {
    if (!activeAuditId) return
    await window.api.auditResumeFromCostCap(activeAuditId)
  }

  async function handleViewFindings() {
    if (!activeProjectId || !activeAuditId) return
    openBrowser(activeAuditId)
    const result = await window.api.auditGet(activeAuditId, activeProjectId)
    if (result) setFindings(result.findings)
  }

  // ── Cost-cap paused state ─────────────────────────────────────────────────
  if (isCostCapPaused) {
    return (
      <div className="border-b border-amber-900/40 bg-amber-950/20 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
            <div>
              <p className="text-xs font-medium text-amber-300">Audit paused — cost cap reached</p>
              <p className="text-[10px] text-amber-600">
                Spent ${currentSpendUsd.toFixed(2)} · {findingsAccumulated} findings so far
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="rounded border border-zinc-700 px-3 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleContinue}
              className="rounded bg-amber-700 px-3 py-1 text-[10px] font-medium text-white hover:bg-amber-600 transition-colors"
            >
              Continue (+50% cap)
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Normal running state ──────────────────────────────────────────────────
  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Loader className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-indigo-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-200">
                Phase {phase}: {PHASE_NAMES[phase] ?? '…'}
              </span>
              <span className="text-xs text-zinc-500">{pct}%</span>
              {remainStr && <span className="text-xs text-zinc-600">{remainStr} remaining</span>}
            </div>
            {message && !isCostCapPaused && (
              <p className="mt-0.5 truncate text-[10px] text-zinc-600">{message}</p>
            )}
            <div className="mt-1.5 h-1 w-full rounded-full bg-zinc-800">
              <div
                className="h-1 rounded-full bg-indigo-600 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          {bySeverity.critical > 0 && (
            <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-red-300">
              {bySeverity.critical} critical
            </span>
          )}
          {bySeverity.high > 0 && (
            <span className="rounded bg-orange-900/60 px-1.5 py-0.5 text-orange-300">
              {bySeverity.high} high
            </span>
          )}
          <span className="text-zinc-600">{findingsAccumulated} total</span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
          <DollarSign className="h-2.5 w-2.5" />
          {currentSpendUsd.toFixed(3)} / ~{estimatedTotalUsd.toFixed(2)}
        </div>

        <div className="flex items-center gap-1">
          {findingsAccumulated > 0 && (
            <button
              onClick={handleViewFindings}
              className="rounded px-2 py-1 text-[10px] text-indigo-400 hover:bg-zinc-800 transition-colors"
            >
              View findings
            </button>
          )}
          <button
            onClick={handleCancel}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
            title="Cancel audit"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
