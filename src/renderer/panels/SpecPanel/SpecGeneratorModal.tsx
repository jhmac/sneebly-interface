import { useEffect, useRef, useState } from 'react'
import {
  X, CheckCircle, Loader, AlertCircle, MinusCircle, FileCode,
  Wand2, ArrowLeft, ChevronRight,
} from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useSpecStore } from '../../state/specStore'
import type { MilestoneRef, RefineMode, ResearchDepth, SpecProgressEvent } from '../../../shared/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage =
  | 'mode-select'
  | 'generate-missing'
  | 'regenerate-all'
  | 'refine-select'
  | 'refine-config'
  | 'running'
  | 'done'

type MilestoneStatus = 'pending' | 'in-progress' | 'done' | 'skipped' | 'error'

interface MilestoneRow {
  ref: MilestoneRef
  checked: boolean
  status: MilestoneStatus
  error?: string
  hasExistingSpec: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPTH_LABELS: Record<ResearchDepth, string> = {
  light: 'Light — Sonnet, ~5 min/spec, basic research',
  standard: 'Standard — Opus, ~15 min/spec, thorough research',
  deep: 'Deep — Opus, ~30 min/spec, exhaustive research',
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

// ── Self-contained export (reads from store) ──────────────────────────────────

export default function SpecGeneratorModal() {
  const { open, initialMode, preselectedMilestoneId, closeModal } = useSpecStore()
  if (!open) return null
  return (
    <SpecGeneratorModalInner
      onClose={closeModal}
      initialMode={initialMode}
      preselectedMilestoneId={preselectedMilestoneId}
    />
  )
}

// ── Modal inner ───────────────────────────────────────────────────────────────

function SpecGeneratorModalInner({
  onClose,
  initialMode,
  preselectedMilestoneId,
}: {
  onClose: () => void
  initialMode: 'mode-select' | 'refine-config'
  preselectedMilestoneId?: string
}) {
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  // Data
  const [rows, setRows] = useState<MilestoneRow[]>([])
  const [loading, setLoading] = useState(true)

  // Navigation
  const [stage, setStage] = useState<Stage>(initialMode === 'refine-config' ? 'refine-config' : 'mode-select')

  // Generate flow options
  const [depth, setDepth] = useState<ResearchDepth>(loadSavedDepth)

  // Refine flow options
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    preselectedMilestoneId ?? null
  )
  const [refinementPrompt, setRefinementPrompt] = useState('')
  const [refineMode, setRefineMode] = useState<RefineMode>('edit-only')

  // Run state
  const [running, setRunning] = useState(false)
  const [flowType, setFlowType] = useState<'generate' | 'refine'>('generate')
  const [done, setDone] = useState(false)
  const [summary, setSummary] = useState<{ generated: number; skipped: number } | null>(null)
  const [refineError, setRefineError] = useState<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  // Load data
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

  // Progress subscription
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

  // ── Derived ──────────────────────────────────────────────────────────────────

  const missingRows = rows.filter((r) => !r.hasExistingSpec)
  const existingCount = rows.filter((r) => r.hasExistingSpec).length
  const selectedMilestone = rows.find((r) => r.ref.id === selectedMilestoneId)?.ref ?? null

  // Specs that have a matching milestone (for refine-select)
  const refinableRows = rows.filter((r) => r.hasExistingSpec)

  // ── Generate handlers ─────────────────────────────────────────────────────────

  // A row is eligible for the active generate stage's selection set.
  function eligibleForStage(r: MilestoneRow, target: 'generate-missing' | 'regenerate-all'): boolean {
    return target === 'regenerate-all' ? true : !r.hasExistingSpec
  }

  // Default selection per stage: only milestones still to build (done rows start
  // unchecked). The "Include already-done milestones" checkbox flips them on.
  function enterGenerateMissing() {
    setRows((prev) => prev.map((r) => ({ ...r, checked: !r.hasExistingSpec && !r.ref.checked })))
    setStage('generate-missing')
  }

  function enterRegenerateAll() {
    setRows((prev) => prev.map((r) => ({ ...r, checked: !r.ref.checked })))
    setStage('regenerate-all')
  }

  // Bulk (un)check the done rows in the active stage's eligible set. The checkbox
  // that drives this is derived from row state, so it can't desync from "Select all"
  // or per-row toggles.
  function setDoneRowsChecked(check: boolean) {
    const target = stage === 'regenerate-all' ? 'regenerate-all' : 'generate-missing'
    setRows((prev) => prev.map((r) =>
      r.ref.checked && eligibleForStage(r, target) ? { ...r, checked: check } : r
    ))
  }

  async function handleGenerate(overwriteExisting: boolean) {
    if (!activeProjectId || running) return
    const selected = rows.filter((r) => r.checked).map((r) => r.ref.id)
    if (selected.length === 0) return

    const includeDone = rows.some((r) => r.ref.checked && r.checked)

    setFlowType('generate')
    setRunning(true)
    setStage('running')
    setRows((prev) => prev.map((r) => r.checked ? { ...r, status: 'pending' } : r))

    try {
      await window.api.specGenerate(activeProjectId, {
        depth,
        milestoneIds: selected,
        includeDone,
        overwriteExisting,
      })
    } finally {
      setRunning(false)
    }
  }

  // ── Refine handlers ───────────────────────────────────────────────────────────

  async function handleRefine() {
    if (!activeProjectId || !selectedMilestoneId || running || !refinementPrompt.trim()) return

    setRefineError(null)
    setFlowType('refine')
    setRunning(true)
    setStage('running')

    // Reset the target row to pending so the running view shows spinner
    setRows((prev) => prev.map((r) =>
      r.ref.id === selectedMilestoneId ? { ...r, status: 'pending' } : r
    ))

    try {
      const result = await window.api.specRefine(activeProjectId, {
        milestoneId: selectedMilestoneId,
        refinementPrompt: refinementPrompt.trim(),
        mode: refineMode,
      })
      if (!result.success) {
        setRefineError(result.error ?? 'Refinement failed.')
        setStage('refine-config')
      }
      // Success: 'complete' progress event drives done state
    } finally {
      setRunning(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const selectedInMissingStage = rows.filter((r) => !r.hasExistingSpec && r.checked).length
  const selectedInAllStage = rows.filter((r) => r.checked).length

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60">
      <div
        className="flex w-[700px] max-h-[86vh] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            {(stage === 'generate-missing' || stage === 'regenerate-all' || stage === 'refine-select' || stage === 'refine-config') && !running && !done && (
              <button
                onClick={() => {
                  if (stage === 'refine-config' && initialMode === 'refine-config') onClose()
                  else setStage('mode-select')
                }}
                className="mr-1 text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <FileCode className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Spec Architect</h2>
            {stage !== 'mode-select' && stage !== 'running' && stage !== 'done' && (
              <span className="text-zinc-600 text-xs">
                {stage === 'generate-missing' && '/ Generate missing'}
                {stage === 'regenerate-all' && '/ Regenerate all'}
                {stage === 'refine-select' && '/ Refine a spec'}
                {stage === 'refine-config' && '/ Refine a spec'}
              </span>
            )}
          </div>
          <button onClick={onClose} disabled={running} className="text-zinc-600 hover:text-zinc-400 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : stage === 'mode-select' ? (
            <ModeSelect
              missingCount={missingRows.length}
              existingCount={existingCount}
              onGenerateMissing={enterGenerateMissing}
              onRegenerateAll={enterRegenerateAll}
              onRefine={() => setStage('refine-select')}
            />
          ) : stage === 'generate-missing' ? (
            <MilestoneListStage
              rows={rows.filter((r) => !r.hasExistingSpec)}
              depth={depth}
              setDepth={(v) => {
                setDepth(v)
                try { localStorage.setItem('spec.depth', v) } catch { /* ignore */ }
              }}
              onSetDoneChecked={setDoneRowsChecked}
              onToggle={(id) => setRows((prev) => prev.map((r) =>
                r.ref.id === id ? { ...r, checked: !r.checked } : r
              ))}
              onToggleAll={() => {
                const missing = rows.filter((r) => !r.hasExistingSpec)
                const allChecked = missing.every((r) => r.checked)
                setRows((prev) => prev.map((r) =>
                  r.hasExistingSpec ? r : { ...r, checked: !allChecked }
                ))
              }}
            />
          ) : stage === 'regenerate-all' ? (
            <MilestoneListStage
              rows={rows}
              depth={depth}
              setDepth={(v) => {
                setDepth(v)
                try { localStorage.setItem('spec.depth', v) } catch { /* ignore */ }
              }}
              onSetDoneChecked={setDoneRowsChecked}
              onToggle={(id) => setRows((prev) => prev.map((r) =>
                r.ref.id === id ? { ...r, checked: !r.checked } : r
              ))}
              onToggleAll={() => {
                const allChecked = rows.every((r) => r.checked)
                setRows((prev) => prev.map((r) => ({ ...r, checked: !allChecked })))
              }}
            />
          ) : stage === 'refine-select' ? (
            <RefineSelect
              refinableRows={refinableRows}
              onSelect={(id) => {
                setSelectedMilestoneId(id)
                setStage('refine-config')
              }}
            />
          ) : stage === 'refine-config' ? (
            <>
              {refineError && (
                <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                  {refineError}
                </div>
              )}
              <RefineConfig
                milestone={selectedMilestone}
                refinableRows={refinableRows}
                refinementPrompt={refinementPrompt}
                setRefinementPrompt={setRefinementPrompt}
                refineMode={refineMode}
                setRefineMode={setRefineMode}
                onChangeSpec={() => setStage('refine-select')}
              />
            </>
          ) : stage === 'running' ? (
            <RunningView
              flowType={flowType}
              rows={rows}
              selectedMilestoneId={selectedMilestoneId}
            />
          ) : done && summary ? (
            <DoneView summary={summary} flowType={flowType} onClose={onClose} />
          ) : null}
        </div>

        {/* Footer */}
        {!loading && !done && stage !== 'mode-select' && stage !== 'refine-select' && stage !== 'running' && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
            <button
              onClick={() => {
                if (stage === 'refine-config' && initialMode === 'refine-config') onClose()
                else setStage('mode-select')
              }}
              disabled={running}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40"
            >
              {stage === 'refine-config' && initialMode === 'refine-config' ? 'Cancel' : 'Back'}
            </button>

            {(stage === 'generate-missing' || stage === 'regenerate-all') && (
              <button
                onClick={() => handleGenerate(stage === 'regenerate-all')}
                disabled={running || (stage === 'generate-missing' ? selectedInMissingStage === 0 : selectedInAllStage === 0)}
                className="flex items-center gap-1.5 rounded-md bg-purple-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
              >
                <FileCode className="h-3.5 w-3.5" />
                {stage === 'generate-missing'
                  ? `Generate ${selectedInMissingStage} spec${selectedInMissingStage !== 1 ? 's' : ''}`
                  : `Regenerate ${selectedInAllStage} spec${selectedInAllStage !== 1 ? 's' : ''}`}
              </button>
            )}

            {stage === 'refine-config' && (
              <button
                onClick={handleRefine}
                disabled={running || !refinementPrompt.trim() || !selectedMilestoneId}
                className="flex items-center gap-1.5 rounded-md bg-purple-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Refine spec
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stage components ──────────────────────────────────────────────────────────

function ModeSelect({
  missingCount,
  existingCount,
  onGenerateMissing,
  onRegenerateAll,
  onRefine,
}: {
  missingCount: number
  existingCount: number
  onGenerateMissing: () => void
  onRegenerateAll: () => void
  onRefine: () => void
}) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <ModeButton
        title="Generate missing specs"
        subtitle={
          missingCount === 0
            ? 'All milestones already have specs.'
            : `Create specs for ${missingCount} milestone${missingCount !== 1 ? 's' : ''} that don't have one yet.`
        }
        icon={<FileCode className="h-5 w-5 text-purple-400" />}
        disabled={missingCount === 0}
        onClick={onGenerateMissing}
      />
      <ModeButton
        title="Regenerate all specs"
        subtitle={
          existingCount === 0
            ? 'No existing specs. Use "Generate missing" first.'
            : `Replace all ${existingCount} existing spec${existingCount !== 1 ? 's' : ''} with fresh research. Slow + expensive.`
        }
        icon={<FileCode className="h-5 w-5 text-zinc-400" />}
        disabled={existingCount === 0}
        onClick={onRegenerateAll}
      />
      <ModeButton
        title="Refine a specific spec"
        subtitle={
          existingCount === 0
            ? 'No existing specs to refine. Generate some first.'
            : `Improve one spec with a custom prompt — tell the agent what to change.`
        }
        icon={<Wand2 className="h-5 w-5 text-purple-400" />}
        disabled={existingCount === 0}
        onClick={onRefine}
      />
    </div>
  )
}

function ModeButton({
  title,
  subtitle,
  icon,
  disabled,
  onClick,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex w-full items-start gap-4 rounded-lg border px-4 py-4 text-left transition-colors',
        disabled
          ? 'border-zinc-800 bg-zinc-900 opacity-40 cursor-not-allowed'
          : 'border-zinc-700 bg-zinc-900 hover:border-purple-700/60 hover:bg-zinc-800 cursor-pointer',
      ].join(' ')}
    >
      <div className="flex-shrink-0 pt-0.5">{icon}</div>
      <div className="flex flex-1 items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">{title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
        </div>
        {!disabled && <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />}
      </div>
    </button>
  )
}

function MilestoneListStage({
  rows,
  depth,
  setDepth,
  onSetDoneChecked,
  onToggle,
  onToggleAll,
}: {
  rows: MilestoneRow[]
  depth: ResearchDepth
  setDepth: (d: ResearchDepth) => void
  onSetDoneChecked: (check: boolean) => void
  onToggle: (id: string) => void
  onToggleAll: () => void
}) {
  const displayedChecked = rows.filter((r) => r.checked).length
  const allChecked = rows.every((r) => r.checked)
  const doneRows = rows.filter((r) => r.ref.checked)
  const hasDoneRows = doneRows.length > 0
  // Derived from row state so it can't drift from "Select all" or per-row toggles.
  const includeDoneChecked = hasDoneRows && doneRows.every((r) => r.checked)

  const phaseGroups = rows.reduce<Record<string, MilestoneRow[]>>((acc, row) => {
    const key = row.ref.phase
    if (!acc[key]) acc[key] = []
    acc[key]!.push(row)
    return acc
  }, {})

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-zinc-600">
        No milestones found for this mode.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Milestone list */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Milestones ({displayedChecked} / {rows.length} selected)
          </label>
          <button
            onClick={onToggleAll}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {allChecked ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        {Object.entries(phaseGroups).map(([phase, phaseRows]) => (
          <div key={phase} className="flex flex-col gap-1">
            <p className="pt-1 text-[10px] uppercase tracking-wide text-zinc-600">{phase}</p>
            {phaseRows.map((row) => (
              <MilestoneRowItem
                key={row.ref.id}
                row={row}
                disabled={false}
                onToggle={() => onToggle(row.ref.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Include already-done milestones */}
      {hasDoneRows && (
        <label className="flex cursor-pointer items-start gap-2.5 border-t border-zinc-800 pt-4">
          <input
            type="checkbox"
            checked={includeDoneChecked}
            onChange={(e) => onSetDoneChecked(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-purple-500"
          />
          <span className="flex flex-col">
            <span className="text-xs text-zinc-200">Include already-done milestones</span>
            <span className="mt-0.5 text-[10px] text-zinc-600">
              By default, specs are only written for milestones still to build. Check this to also
              write descriptive specs for completed milestones (useful for documentation).
            </span>
          </span>
        </label>
      )}

      {/* Depth */}
      <div className="flex flex-col gap-1 border-t border-zinc-800 pt-4">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Research depth</label>
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value as ResearchDepth)}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-600"
        >
          {(Object.keys(DEPTH_LABELS) as ResearchDepth[]).map((d) => (
            <option key={d} value={d}>{DEPTH_LABELS[d]}</option>
          ))}
        </select>
        <p className="text-[10px] text-zinc-600">Estimated cost: {DEPTH_COST[depth]}</p>
      </div>
    </div>
  )
}

function RefineSelect({
  refinableRows,
  onSelect,
}: {
  refinableRows: MilestoneRow[]
  onSelect: (milestoneId: string) => void
}) {
  if (refinableRows.length === 0) {
    return <p className="py-8 text-center text-xs text-zinc-600">No specs with linked milestones found.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
        Select a spec to refine
      </p>
      {refinableRows.map((row) => (
        <div
          key={row.ref.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-200">{row.ref.text}</p>
            <p className="mt-0.5 text-[10px] text-zinc-600">
              {row.ref.phase} · SPEC_{row.ref.specSlug}.md
            </p>
          </div>
          <button
            onClick={() => onSelect(row.ref.id)}
            className="flex flex-shrink-0 items-center gap-1 rounded bg-purple-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-purple-600"
          >
            <Wand2 className="h-3 w-3" />
            Refine
          </button>
        </div>
      ))}
    </div>
  )
}

function RefineConfig({
  milestone,
  refinableRows,
  refinementPrompt,
  setRefinementPrompt,
  refineMode,
  setRefineMode,
  onChangeSpec,
}: {
  milestone: MilestoneRef | null
  refinableRows: MilestoneRow[]
  refinementPrompt: string
  setRefinementPrompt: (v: string) => void
  refineMode: RefineMode
  setRefineMode: (m: RefineMode) => void
  onChangeSpec: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Which spec */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Refining spec</p>
        {milestone ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-zinc-200">{milestone.text}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                {milestone.phase} · SPEC_{milestone.specSlug}.md
              </p>
            </div>
            {refinableRows.length > 1 && (
              <button
                onClick={onChangeSpec}
                className="flex-shrink-0 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors underline"
              >
                Change
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No spec selected.</p>
        )}
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">
          What should change?
        </label>
        <textarea
          value={refinementPrompt}
          onChange={(e) => setRefinementPrompt(e.target.value)}
          rows={6}
          placeholder={
            'Example: The UI section is too vague — add specific component names, exact button copy, ' +
            'and the empty-state design. Also the database schema is missing indexes.'
          }
          className="resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
        />
      </div>

      {/* Mode */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Refinement approach</label>
        <RefineRadio
          value="edit-only"
          selected={refineMode === 'edit-only'}
          onSelect={() => setRefineMode('edit-only')}
          title="Edit only"
          subtitle="Agent edits the existing spec based on your notes. No new research."
          cost="~$0.10–0.30, 1–2 min"
        />
        <RefineRadio
          value="research"
          selected={refineMode === 'research'}
          onSelect={() => setRefineMode('research')}
          title="Re-research"
          subtitle="Agent does fresh web research focused on your notes. Best quality."
          cost="~$0.50–2.00, 10–30 min"
        />
      </div>
    </div>
  )
}

function RefineRadio({
  value,
  selected,
  onSelect,
  title,
  subtitle,
  cost,
}: {
  value: RefineMode
  selected: boolean
  onSelect: () => void
  title: string
  subtitle: string
  cost: string
}) {
  return (
    <button
      onClick={onSelect}
      className={[
        'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-purple-700/70 bg-purple-950/20' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700',
      ].join(' ')}
    >
      <span className={[
        'mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border',
        selected ? 'border-purple-500' : 'border-zinc-600',
      ].join(' ')}>
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />}
      </span>
      <div>
        <p className="text-xs font-medium text-zinc-200">{title}</p>
        <p className="mt-0.5 text-[10px] text-zinc-500">{subtitle}</p>
        <p className="mt-0.5 text-[10px] text-zinc-600">{cost}</p>
      </div>
    </button>
  )
}

function RunningView({
  flowType,
  rows,
  selectedMilestoneId,
}: {
  flowType: 'generate' | 'refine'
  rows: MilestoneRow[]
  selectedMilestoneId: string | null
}) {
  if (flowType === 'refine') {
    const row = rows.find((r) => r.ref.id === selectedMilestoneId)
    return (
      <div className="flex flex-col gap-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Refining spec</p>
        {row ? (
          <MilestoneRowItem row={row} disabled={true} onToggle={() => {}} />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2">
            <Loader className="h-3.5 w-3.5 animate-spin text-purple-400" />
            <span className="text-xs text-zinc-400">Refining…</span>
          </div>
        )}
      </div>
    )
  }

  // Generate flow: show all checked rows
  const activeRows = rows.filter((r) => r.checked || r.status !== 'pending')
  const phaseGroups = activeRows.reduce<Record<string, MilestoneRow[]>>((acc, row) => {
    const key = row.ref.phase
    if (!acc[key]) acc[key] = []
    acc[key]!.push(row)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Generating specs</p>
      {Object.entries(phaseGroups).map(([phase, phaseRows]) => (
        <div key={phase} className="flex flex-col gap-1">
          <p className="pt-1 text-[10px] uppercase tracking-wide text-zinc-600">{phase}</p>
          {phaseRows.map((row) => (
            <MilestoneRowItem key={row.ref.id} row={row} disabled={true} onToggle={() => {}} />
          ))}
        </div>
      ))}
    </div>
  )
}

function DoneView({
  summary,
  flowType,
  onClose,
}: {
  summary: { generated: number; skipped: number }
  flowType: 'generate' | 'refine'
  onClose: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <CheckCircle className="h-10 w-10 text-green-500" />
      <div className="text-center">
        {flowType === 'refine' ? (
          <p className="text-sm font-medium text-zinc-100">Spec refined successfully</p>
        ) : (
          <p className="text-sm font-medium text-zinc-100">
            Generated {summary.generated} spec{summary.generated !== 1 ? 's' : ''}
          </p>
        )}
        {summary.skipped > 0 && (
          <p className="mt-1 text-xs text-zinc-500">{summary.skipped} skipped (already exist)</p>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          Specs saved to <code className="text-zinc-400">specs/</code>
          {flowType !== 'refine' && ' · GOALS.md updated with links'}
        </p>
      </div>
      <button
        onClick={onClose}
        className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 transition-colors"
      >
        Done
      </button>
    </div>
  )
}

// ── Shared row component ──────────────────────────────────────────────────────

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
        <Loader className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-purple-400" />
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
        row.status === 'done' || row.status === 'skipped' ? 'text-zinc-400' : 'text-zinc-200',
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
        <span className="flex-shrink-0 max-w-[160px] truncate text-[10px] text-red-400">{row.error}</span>
      )}
    </div>
  )
}
