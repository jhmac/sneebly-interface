import { useEffect, useCallback } from 'react'
import { X, Search, FolderOpen } from 'lucide-react'
import {
  useAuditorStore, getFilteredFindings,
  type SeverityFilter, type CategoryFilter, type GroupBy,
} from '../../state/auditorStore'
import { useProjectStore } from '../../state/projectStore'
import AuditFindingRow from './AuditFinding'
import AuditFindingDetail from './AuditFindingDetail'
import AuditEmptyState from './AuditEmptyState'
import type { AuditFinding } from '../../../shared/types'

const SEVERITY_FILTERS: SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low']
const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'security', 'correctness', 'convention', 'schema', 'depsec', 'env', 'todo', 'smell']
const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'severity', label: 'By severity' },
  { value: 'category', label: 'By category' },
  { value: 'file', label: 'By file' },
]

function groupFindings(findings: AuditFinding[], groupBy: GroupBy): Array<{ label: string; items: AuditFinding[] }> {
  if (groupBy === 'none') return [{ label: '', items: findings }]

  const groups = new Map<string, AuditFinding[]>()
  for (const f of findings) {
    const key = groupBy === 'file' ? f.filePath
      : groupBy === 'severity' ? f.severity
      : f.category
    const group = groups.get(key) ?? []
    group.push(f)
    groups.set(key, group)
  }

  return Array.from(groups.entries())
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export default function AuditFindingsBrowser() {
  const store = useAuditorStore()
  const { activeProjectId } = useProjectStore()
  const {
    browserOpen, closeBrowser, activeAuditId, findings, findingsLoading,
    severityFilter, setSeverityFilter, categoryFilter, setCategoryFilter,
    groupBy, setGroupBy, fileSearch, setFileSearch,
    showResolved, setShowResolved, selectedFindingId, selectFinding,
    patchFinding,
  } = store

  useEffect(() => {
    if (!browserOpen || !activeAuditId || !activeProjectId) return
    window.api.auditGet(activeAuditId, activeProjectId).then((result) => {
      if (result) store.setFindings(result.findings)
    }).catch(console.error)
  }, [browserOpen, activeAuditId, activeProjectId])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!browserOpen) return
    const filtered = getFilteredFindings(store)
    const currentIdx = filtered.findIndex((f) => f.id === selectedFindingId)

    switch (e.key) {
      case 'j': case 'ArrowDown': {
        e.preventDefault()
        const next = filtered[currentIdx + 1]
        if (next) selectFinding(next.id)
        break
      }
      case 'k': case 'ArrowUp': {
        e.preventDefault()
        const prev = filtered[currentIdx - 1]
        if (prev) selectFinding(prev.id)
        break
      }
      case 'r': {
        const f = filtered[currentIdx]
        if (f) handleMarkResolved(f.id, !f.resolved)
        break
      }
      case 'f': {
        const f = filtered[currentIdx]
        if (f) handleMarkFalsePositive(f.id, !f.falsePositive)
        break
      }
      case 'Escape':
        if (selectedFindingId) selectFinding(null)
        else closeBrowser()
        break
    }
  }, [browserOpen, selectedFindingId, store])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!browserOpen) return null

  const filtered = getFilteredFindings(store)
  const grouped = groupFindings(filtered, groupBy)
  const selectedFinding = findings.find((f) => f.id === selectedFindingId) ?? null

  async function handleMarkResolved(findingId: string, resolved: boolean) {
    if (!activeAuditId || !activeProjectId) return
    await window.api.auditMarkResolved(activeAuditId, activeProjectId, findingId, resolved)
    patchFinding(findingId, {
      resolved,
      resolvedAt: resolved ? Date.now() : null,
    })
  }

  async function handleMarkFalsePositive(findingId: string, fp: boolean) {
    if (!activeAuditId || !activeProjectId) return
    await window.api.auditMarkFalsePositive(activeAuditId, activeProjectId, findingId, fp)
    patchFinding(findingId, { falsePositive: fp, falsePositiveReason: fp ? '' : null })
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings.filter((f) => !f.resolved && !f.falsePositive)) bySeverity[f.severity]++

  return (
    <div className="fixed inset-0 z-[75] flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-zinc-100">Audit Findings</h2>
          <div className="flex gap-2 text-[10px]">
            {bySeverity.critical > 0 && <span className="text-red-400">{bySeverity.critical} critical</span>}
            {bySeverity.high > 0 && <span className="text-orange-400">{bySeverity.high} high</span>}
            {bySeverity.medium > 0 && <span className="text-amber-400">{bySeverity.medium} medium</span>}
            {bySeverity.low > 0 && <span className="text-zinc-500">{bySeverity.low} low</span>}
          </div>
        </div>
        <button onClick={closeBrowser} className="text-zinc-600 hover:text-zinc-400">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-zinc-800 px-5 py-2">
        {/* Severity filter */}
        <div className="flex gap-1">
          {SEVERITY_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={[
                'rounded px-2 py-0.5 text-[10px] transition-colors',
                severityFilter === s ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="h-3 w-px bg-zinc-800" />

        {/* File search */}
        <div className="flex items-center gap-1 rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
          <Search className="h-3 w-3 text-zinc-600" />
          <input
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            placeholder="Filter by file or title…"
            className="w-40 bg-transparent text-[10px] text-zinc-300 placeholder-zinc-600 outline-none"
          />
        </div>

        {/* Group by */}
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 outline-none"
        >
          {GROUP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-[10px] text-zinc-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="h-2.5 w-2.5 accent-indigo-500"
          />
          Show resolved
        </label>

        {activeAuditId && (
          <button
            onClick={() => window.api.auditRevealInFinder(activeAuditId, activeProjectId!)}
            className="ml-auto flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <FolderOpen className="h-3 w-3" />
            Open folder
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Findings list */}
        <div className="w-96 flex-shrink-0 overflow-y-auto border-r border-zinc-800" role="feed" aria-busy={findingsLoading}>
          {findingsLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-600">Loading…</div>
          ) : filtered.length === 0 ? (
            <AuditEmptyState
              hasFindings={findings.length > 0}
              allResolved={findings.length > 0 && findings.every((f) => f.resolved)}
            />
          ) : (
            grouped.map((group) => (
              <div key={group.label}>
                {group.label && (
                  <div className="sticky top-0 border-b border-zinc-800 bg-zinc-950 px-4 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{group.label}</p>
                  </div>
                )}
                {group.items.map((f) => (
                  <AuditFindingRow
                    key={f.id}
                    finding={f}
                    selected={f.id === selectedFindingId}
                    onClick={() => selectFinding(f.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Detail pane */}
        <div className="flex-1 min-w-0" aria-live="polite">
          {selectedFinding ? (
            <AuditFindingDetail
              finding={selectedFinding}
              onMarkResolved={handleMarkResolved}
              onMarkFalsePositive={handleMarkFalsePositive}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              Select a finding to see details
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex-shrink-0 border-t border-zinc-800 px-5 py-1.5">
        <p className="text-[9px] text-zinc-700">
          J/K navigate · R resolve · F false positive · Esc close
        </p>
      </div>
    </div>
  )
}
