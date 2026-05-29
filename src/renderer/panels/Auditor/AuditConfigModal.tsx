import { useState, useEffect } from 'react'
import { X, Shield, DollarSign, AlertTriangle } from 'lucide-react'
import { useAuditorStore, DEFAULT_SCOPE } from '../../state/auditorStore'
import { useProjectStore } from '../../state/projectStore'
import { useSettingsStore } from '../../state/settingsStore'
import AuditModePicker from './AuditModePicker'
import type { AuditScope } from '../../../shared/types'

const SCOPE_ITEMS: Array<{ key: keyof AuditScope; label: string; description: string }> = [
  { key: 'codeReview', label: 'Code Review', description: 'Bugs, race conditions, error handling' },
  { key: 'securityScan', label: 'Security Scan', description: 'Injection, auth, secrets, XSS' },
  { key: 'schemaReview', label: 'Schema Review', description: 'Missing constraints, indexes, cascades' },
  { key: 'conventionCheck', label: 'Convention Check', description: 'CLAUDE.md violations' },
  { key: 'dependencySecurityCheck', label: 'Dependency Security', description: 'npm audit + LLM judgment' },
  { key: 'envVarCheck', label: 'Env Var Check', description: 'Undocumented / unused env vars' },
  { key: 'staleTodoCheck', label: 'Stale TODOs', description: 'Old TODO/FIXME comments' },
]

export default function AuditConfigModal() {
  const {
    configOpen, closeConfig, scope, setScope, mode, setMode,
    estimate, setEstimate, estimating, setEstimating, markAuditStarted,
    openBrowser, setFindings,
  } = useAuditorStore()
  const { activeProjectId } = useProjectStore()
  const { settings } = useSettingsStore()

  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAuditDate, setLastAuditDate] = useState<string | undefined>()

  useEffect(() => {
    if (!configOpen || !activeProjectId) return
    window.api.auditGetLast(activeProjectId).then((last) => {
      if (last?.completedAt) {
        setLastAuditDate(new Date(last.completedAt).toLocaleDateString())
      }
    }).catch(() => {})
  }, [configOpen, activeProjectId])

  useEffect(() => {
    if (!configOpen || !activeProjectId) return
    setEstimating(true)
    setEstimate(null)
    window.api.auditEstimate({
      projectId: activeProjectId,
      scope,
      mode,
    }).then((est) => {
      setEstimate(est)
      setEstimating(false)
    }).catch((err) => {
      setEstimating(false)
      console.error('[AuditConfigModal] estimate error', err)
    })
  }, [configOpen, activeProjectId, scope, mode])

  if (!configOpen) return null

  const ceiling = settings?.auditorCostCeilingUsd ?? 50
  const exceedsCeiling = estimate?.exceedsCostCeiling ?? false

  async function handleStart() {
    if (!activeProjectId || starting) return
    setStarting(true)
    setError(null)
    try {
      const { auditId } = await window.api.auditStart({
        projectId: activeProjectId,
        scope,
        mode,
      })
      markAuditStarted(auditId)
      closeConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStarting(false)
    }
  }

  async function handleDryRun() {
    if (!activeProjectId) return
    setStarting(true)
    setError(null)
    try {
      const result = await window.api.auditDryRun({
        projectId: activeProjectId,
        scope,
        mode,
      })
      // Show dry run result — for now, log it
      console.log('[DryRun]', result)
      closeConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStarting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
      <div className="flex w-[520px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Sentinel Audit</h2>
          </div>
          <button onClick={closeConfig} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode picker */}
        <div className="px-5 pt-4">
          <p className="mb-2 text-xs font-medium text-zinc-400">Mode</p>
          <AuditModePicker mode={mode} onChange={setMode} lastAuditDate={lastAuditDate} />
        </div>

        {/* Scope */}
        <div className="px-5 pt-4">
          <p className="mb-2 text-xs font-medium text-zinc-400">Scope</p>
          <div className="grid grid-cols-2 gap-2">
            {SCOPE_ITEMS.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 p-2.5 hover:border-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={scope[item.key]}
                  onChange={(e) => setScope({ ...scope, [item.key]: e.target.checked })}
                  className="mt-0.5 h-3 w-3 accent-indigo-500"
                />
                <div>
                  <p className="text-xs font-medium text-zinc-200">{item.label}</p>
                  <p className="text-[10px] text-zinc-500">{item.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Cost estimate */}
        <div className="mx-5 mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400">Estimated cost</span>
          </div>
          {estimating ? (
            <p className="mt-1 text-xs text-zinc-600">Calculating…</p>
          ) : estimate ? (
            <div className="mt-1 flex items-center gap-4">
              <span className="text-sm font-semibold text-zinc-100">
                ${estimate.estimatedCostUsdMin.toFixed(2)} – ${estimate.estimatedCostUsdMax.toFixed(2)}
              </span>
              <span className="text-xs text-zinc-500">
                {estimate.fileCount} files · ~{Math.round(estimate.estimatedDurationMs / 60000)}m
              </span>
              {exceedsCeiling && (
                <span className="flex items-center gap-1 text-xs text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Exceeds ${ceiling} ceiling
                </span>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-600">No estimate</p>
          )}
        </div>

        {error && (
          <p className="mx-5 mt-3 text-xs text-red-400">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-4 mt-4">
          <button
            onClick={handleDryRun}
            disabled={starting}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Dry run
          </button>
          <div className="flex gap-2">
            <button
              onClick={closeConfig}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={starting || !activeProjectId}
              className={[
                'rounded-lg px-5 py-2 text-xs font-medium text-white transition-colors disabled:opacity-40',
                exceedsCeiling
                  ? 'bg-amber-700 hover:bg-amber-600'
                  : 'bg-indigo-600 hover:bg-indigo-500',
              ].join(' ')}
            >
              {starting ? 'Starting…' : exceedsCeiling ? 'Start anyway' : 'Start audit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
