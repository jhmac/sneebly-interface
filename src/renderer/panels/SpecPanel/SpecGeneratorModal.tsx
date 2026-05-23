import { useEffect, useRef, useState } from 'react'
import { X, CheckCircle, Loader, AlertCircle, MinusCircle, FileCode } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import type { MilestoneRef, ResearchDepth, SpecProgressEvent } from '../../../shared/types'

type MilestoneStatus = 'pending' | 'in-progress' | 'done' | 'skipped' | 'error'

interface MilestoneRow {
  ref: MilestoneRef
  checked: boolean
  status: MilestoneStatus
  error?: string
  hasExistingSpec: boolean
}

const DEPTH_LABELS: Record<ResearchDepth, string> = {
  light: 'Light — Sonnet, ~5 min/spec, basic research',
  standard: 'Standard — Opus, ~15 min/spec, thorough research',
  deep: 'Deep — Opus, ~30 min/spec, exhaustive research + browser checks',
}

const DEPTH_COST: Record<ResearchDepth, string> = {
  light: '~$0.10–0.30 per spec',
  standard: '~$0.30–0.80 per spec',
  deep: '~$0.50–2.00 per spec',
}

function loadSavedDepth(): ResearchDepth {
  try {
    const saved = localStorage.getItem('spec.depth') as ResearchDepth | null
    if (saved && saved in DEPTH_LABELS) return saved
  } catch { /* ignore */ }
  return 'deep'
}

export default function SpecGeneratorModal({ onClose }: { onClose: () => void }) {
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const [rows, setRows] = useState<MilestoneRow[]>([])
  const [loading, setLoading] = useState(true)
  const [depth, setDepth] = useState<ResearchDepth>(loadSavedDepth)
  const [overwrite, setOverwrite] = useState(false)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [summary, setSummary] = useState<{ generated: number; skipped: number } | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!activeProject) return
    Promise.all([
      window.api.specListMilestones(activeProject.path),
      window.api.specList(activeProject.path),
    ]).then(([milestones, existingSpecs]) => {
      const existingSet = new Set(existingSpecs.map((f) => f.replace('.md', '')))
      setRows(milestones.map((m) => ({
        ref: m,
        checked: true,
        status: 'pending',
        hasExistingSpec: existingSet.has(`SPEC_${m.specSlug}`),
      })))
      setLoading(false)
    })
  }, [activeProject?.path])

  // Subscribe to progress events
  useEffect(() => {
    unsubRef.current = window.api.specOnProgress((event: SpecProgressEvent) => {
      if (event.type === 'milestone-start' && event.milestoneId) {
        setRows((prev) => prev.map((r) =>
          r.ref.id === event.milestoneId ? { ...r, status: 'in-progress' } : r
        ))
      }
      if (event.type === 'milestone-done' && event.milestoneId) {
        setRows((prev) => prev.map((r) =>
          r.ref.id === event.milestoneId ? { ...r, status: 'done' } : r
        ))
      }
      if (event.type === 'milestone-skipped' && event.milestoneId) {
        setRows((prev) => prev.map((r) =>
          r.ref.id === event.milestoneId ? { ...r, status: 'skipped' } : r
        ))
      }
      if (event.type === 'error' && event.milestoneId) {
        setRows((prev) => prev.map((r) =>
          r.ref.id === event.milestoneId
            ? { ...r, status: 'error', error: event.error }
            : r
        ))
      }
      if (event.type === 'complete') {
        setSummary({ generated: event.generatedCount ?? 0, skipped: event.skippedCount ?? 0 })
        setRunning(false)
        setDone(true)
      }
    })
    return () => unsubRef.current?.()
  }, [])

  function toggleAll() {
    const allChecked = rows.every((r) => r.checked)
    setRows((prev) => prev.map((r) => ({ ...r, checked: !allChecked })))
  }

  async function handleGenerate() {
    if (!activeProjectId || running) return
    const selected = rows.filter((r) => r.checked).map((r) => r.ref.id)
    if (selected.length === 0) return

    setRunning(true)
    setRows((prev) => prev.map((r) =>
      r.checked ? { ...r, status: 'pending' } : r
    ))

    try {
      await window.api.specGenerate(activeProjectId, {
        depth,
        milestoneIds: selected,
        overwriteExisting: overwrite,
      })
    } finally {
      // If the 'complete' progress event didn't fire (e.g. generation was already
      // in progress for this project), the running flag would be stuck. Reset it.
      setRunning(false)
    }
  }

  const selectedCount = rows.filter((r) => r.checked).length
  const phaseGroups = rows.reduce<Record<string, MilestoneRow[]>>((acc, row) => {
    const key = row.ref.phase
    if (!acc[key]) acc[key] = []
    acc[key].push(row)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="flex w-[680px] max-h-[85vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Spec Architect</h2>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {loading ? (
            <p className="py-8 text-center text-xs text-zinc-600">Loading milestones…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">
              No milestones found. Add phases with milestones to GOALS.md.
            </p>
          ) : done && summary ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-100">
                  Generated {summary.generated} spec{summary.generated !== 1 ? 's' : ''}
                </p>
                {summary.skipped > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">{summary.skipped} skipped (already exist)</p>
                )}
                <p className="mt-1 text-xs text-zinc-500">
                  Specs saved to <code className="text-zinc-400">specs/</code> · GOALS.md updated with links
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Milestone list */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Milestones ({selectedCount} / {rows.length} selected)
                  </label>
                  <button
                    onClick={toggleAll}
                    disabled={running}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                  >
                    {rows.every((r) => r.checked) ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                {Object.entries(phaseGroups).map(([phase, phaseRows]) => (
                  <div key={phase} className="flex flex-col gap-1">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-600 pt-1">{phase}</p>
                    {phaseRows.map((row) => (
                      <MilestoneRowItem
                        key={row.ref.id}
                        row={row}
                        disabled={running}
                        onToggle={() => setRows((prev) => prev.map((r) =>
                          r.ref.id === row.ref.id ? { ...r, checked: !r.checked } : r
                        ))}
                      />
                    ))}
                  </div>
                ))}
              </div>

              {/* Options */}
              <div className="flex flex-col gap-3 border-t border-zinc-800 pt-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Research depth
                  </label>
                  <select
                    value={depth}
                    onChange={(e) => {
                      const v = e.target.value as ResearchDepth
                      setDepth(v)
                      try { localStorage.setItem('spec.depth', v) } catch { /* ignore */ }
                    }}
                    disabled={running}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
                  >
                    {(Object.keys(DEPTH_LABELS) as ResearchDepth[]).map((d) => (
                      <option key={d} value={d}>{DEPTH_LABELS[d]}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-600">Estimated cost: {DEPTH_COST[depth]}</p>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                    disabled={running}
                    className="h-3.5 w-3.5 accent-purple-500"
                  />
                  <span className="text-xs text-zinc-400">Overwrite existing specs</span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!done && !loading && rows.length > 0 && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
            <button
              onClick={onClose}
              disabled={running}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={running || selectedCount === 0}
              className="flex items-center gap-1.5 rounded-md bg-purple-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
            >
              {running ? (
                <>
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <FileCode className="h-3.5 w-3.5" />
                  Generate {selectedCount} spec{selectedCount !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MilestoneRowItem({
  row,
  disabled,
  onToggle,
}: {
  row: MilestoneRow
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div className={[
      'flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs',
      row.status === 'in-progress'
        ? 'border-purple-800 bg-purple-950/30'
        : row.status === 'done'
        ? 'border-green-900 bg-green-950/20'
        : row.status === 'error'
        ? 'border-red-900 bg-red-950/20'
        : row.status === 'skipped'
        ? 'border-zinc-800 bg-zinc-900 opacity-50'
        : 'border-zinc-800 bg-zinc-900',
    ].join(' ')}>
      {row.status === 'in-progress' ? (
        <Loader className="h-3.5 w-3.5 flex-shrink-0 text-purple-400 animate-spin" />
      ) : row.status === 'done' ? (
        <CheckCircle className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
      ) : row.status === 'skipped' ? (
        <MinusCircle className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600" />
      ) : row.status === 'error' ? (
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
      ) : (
        <input
          type="checkbox"
          checked={row.checked}
          onChange={onToggle}
          disabled={disabled}
          className="h-3.5 w-3.5 flex-shrink-0 accent-purple-500 disabled:opacity-40"
        />
      )}
      <span className={[
        'flex-1 truncate',
        row.status === 'done' ? 'text-zinc-400' : 'text-zinc-200',
      ].join(' ')}>
        {row.ref.text}
        {row.ref.checked && (
          <span className="ml-1.5 text-[10px] text-zinc-600">(done)</span>
        )}
      </span>
      {row.hasExistingSpec && row.status === 'pending' && (
        <span className="flex-shrink-0 text-[10px] text-zinc-600">spec exists</span>
      )}
      {row.status === 'error' && row.error && (
        <span className="flex-shrink-0 text-[10px] text-red-400 max-w-[160px] truncate">{row.error}</span>
      )}
    </div>
  )
}
