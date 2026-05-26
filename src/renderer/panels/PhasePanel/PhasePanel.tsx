import { useEffect, useState } from 'react'
import {
  X, RefreshCw, Play, Square, ChevronDown, ChevronRight,
  CheckCircle2, Circle, Loader2, AlertTriangle, Zap,
  ClipboardList, FileCode, ArrowRight, ScanSearch
} from 'lucide-react'
import { usePhaseStore } from '../../state/phaseStore'
import type { OrderedMilestone, PhasePlan, PhaseRunConfig, PhaseRunState, PhaseAuditProgress } from '../../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string | null
}

export default function PhasePanel({ open, onClose, projectId }: Props) {
  if (!open || !projectId) return null
  return <PhasePanelInner onClose={onClose} projectId={projectId} />
}

function PhasePanelInner({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const { plan, runState, generating, loadError, load, generate, completeMilestone, startRun, stopRun, setRunState } =
    usePhaseStore()

  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set())
  const [runConfigOpen, setRunConfigOpen] = useState(false)
  const [batchSize, setBatchSize] = useState(3)
  const [activeChecklist, setActiveChecklist] = useState<string[] | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [auditProgress, setAuditProgress] = useState<PhaseAuditProgress | null>(null)

  useEffect(() => {
    load(projectId)
  }, [projectId])

  // Subscribe to run state changes pushed from main
  useEffect(() => {
    const unsub = window.api.phaseOnRunStateChanged((_pid, state) => {
      setRunState(state)
      if (state.activeChecklist.length > 0) {
        setActiveChecklist(state.activeChecklist)
      }
    })
    return unsub
  }, [])

  // Subscribe to audit progress events pushed from main
  useEffect(() => {
    const unsub = window.api.phaseOnAuditProgress((progress) => {
      setAuditProgress(progress)
      if (progress.stage === 'done') {
        setAuditing(false)
        load(projectId)
      }
    })
    return unsub
  }, [projectId])

  // Auto-expand the active phase on load
  useEffect(() => {
    if (!plan) return
    const activePhaseNum = plan.milestones.find((m) => !m.checked)?.phaseNumber
    if (activePhaseNum !== undefined) {
      setExpandedPhases(new Set([activePhaseNum]))
    }
  }, [plan])

  const handleGenerate = () => generate(projectId)

  const handleAudit = async () => {
    setAuditing(true)
    setAuditProgress(null)
    try {
      await window.api.phaseAudit(projectId)
    } catch {
      // error already surfaced via progress event if main process threw
    } finally {
      setAuditing(false)
    }
  }

  const handleAuditStop = () => {
    window.api.phaseAuditStop(projectId)
    setAuditing(false)
  }

  const handleBuildMilestone = async (milestoneId: string) => {
    const milestone = plan?.milestones.find((m) => m.id === milestoneId)
    if (!milestone) return
    const fill = await window.api.phaseKickoffFill(projectId, milestoneId)
    if (!fill) return
    // Dispatch a custom event that the ChatPanel listens for — prefills the composer
    window.dispatchEvent(new CustomEvent('sneebly:prefill-chat', {
      detail: { text: fill.text, specPath: fill.specPath },
    }))
    onClose()
  }

  const handleStartRun = async () => {
    setRunConfigOpen(false)
    const nextMilestone = plan?.milestones.find((m) => !m.checked)
    if (!nextMilestone) return
    const config: PhaseRunConfig = {
      batchSize,
      startFromMilestoneId: nextMilestone.id,
      autoReview: true,
    }
    await startRun(projectId, config)
  }

  const handleStopRun = () => stopRun(projectId)

  const handleMarkComplete = async (milestoneId: string) => {
    await completeMilestone(projectId, milestoneId)
  }

  if (!plan && !generating) {
    return (
      <Overlay onClose={onClose}>
        <PanelShell onClose={onClose} title="Phase Tracker">
          <EmptyState onGenerate={handleGenerate} />
        </PanelShell>
      </Overlay>
    )
  }

  if (generating) {
    return (
      <Overlay onClose={onClose}>
        <PanelShell onClose={onClose} title="Phase Tracker">
          <GeneratingState />
        </PanelShell>
      </Overlay>
    )
  }

  if (!plan) return null

  const phases = buildPhaseGroups(plan)
  const totalMilestones = plan.milestones.length
  const completedMilestones = plan.milestones.filter((m) => m.checked).length
  const activeMilestone = plan.milestones.find(
    (m) => m.id === runState.currentMilestoneId
  )

  return (
    <Overlay onClose={onClose}>
      <PanelShell onClose={onClose} title="Phase Tracker">
        {/* Header stats + controls */}
        <div className="flex flex-shrink-0 items-center gap-4 border-b border-zinc-800 px-6 py-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-xs text-zinc-500">
                {completedMilestones}/{totalMilestones} milestones
              </div>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${totalMilestones > 0 ? (completedMilestones / totalMilestones) * 100 : 0}%` }}
                />
              </div>
            </div>
            {plan.buildSummary && (
              <p className="mt-0.5 line-clamp-1 text-[10px] text-zinc-600">{plan.buildSummary}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {auditing ? (
              <button
                onClick={handleAuditStop}
                title="Stop audit"
                className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-red-900/60 hover:text-red-300"
              >
                <Square className="h-3 w-3" />
                Stop audit
              </button>
            ) : (
              <button
                onClick={handleAudit}
                disabled={runState.status === 'building'}
                title="Audit codebase to auto-check completed milestones"
                className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ScanSearch className="h-3 w-3" />
                Audit
              </button>
            )}
            {runState.status === 'idle' || runState.status === 'paused' || runState.status === 'complete' ? (
              <button
                onClick={() => setRunConfigOpen(true)}
                disabled={auditing}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="h-3 w-3" />
                {runState.status === 'paused' ? 'Resume run' : 'Start run'}
              </button>
            ) : (
              <button
                onClick={handleStopRun}
                className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={auditing}
              title="Re-generate build order"
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Run status bar */}
        {runState.status !== 'idle' && (
          <RunStatusBar runState={runState} activeMilestone={activeMilestone} />
        )}

        {/* Audit progress bar */}
        {auditProgress && (
          <AuditProgressBar progress={auditProgress} onDismiss={() => setAuditProgress(null)} />
        )}

        {/* Error */}
        {loadError && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {loadError}
          </div>
        )}

        {/* Active test checklist */}
        {activeChecklist && activeChecklist.length > 0 && (
          <ChecklistCard
            items={activeChecklist}
            onDismiss={() => setActiveChecklist(null)}
          />
        )}

        {/* Phase list */}
        <div className="flex-1 overflow-y-auto">
          {phases.map((phase) => (
            <PhaseGroup
              key={phase.phaseNumber}
              phase={phase}
              runState={runState}
              expanded={expandedPhases.has(phase.phaseNumber)}
              onToggle={() =>
                setExpandedPhases((prev) => {
                  const next = new Set(prev)
                  if (next.has(phase.phaseNumber)) next.delete(phase.phaseNumber)
                  else next.add(phase.phaseNumber)
                  return next
                })
              }
              onBuild={handleBuildMilestone}
              onMarkComplete={handleMarkComplete}
            />
          ))}
        </div>

        {/* Run config modal */}
        {runConfigOpen && (
          <RunConfigModal
            plan={plan}
            batchSize={batchSize}
            onBatchSizeChange={setBatchSize}
            onConfirm={handleStartRun}
            onCancel={() => setRunConfigOpen(false)}
          />
        )}
      </PanelShell>
    </Overlay>
  )
}

// ── Phase group ────────────────────────────────────────────────────────────

interface PhaseGroupData {
  phaseNumber: number
  phaseName: string
  milestones: OrderedMilestone[]
  completedCount: number
  isActive: boolean
  isComplete: boolean
}

function buildPhaseGroups(plan: PhasePlan): PhaseGroupData[] {
  const byPhase = new Map<number, OrderedMilestone[]>()
  for (const m of [...plan.milestones].sort((a, b) => a.buildOrder - b.buildOrder)) {
    if (!byPhase.has(m.phaseNumber)) byPhase.set(m.phaseNumber, [])
    byPhase.get(m.phaseNumber)!.push(m)
  }

  const firstIncompletePhase = plan.milestones.find((m) => !m.checked)?.phaseNumber

  return Array.from(byPhase.entries())
    .sort(([a], [b]) => a - b)
    .map(([num, milestones]) => {
      const namePart = milestones[0]!.phase.replace(/^Phase\s+\d+:?\s*/i, '').trim()
      const completed = milestones.filter((m) => m.checked).length
      return {
        phaseNumber: num,
        phaseName: namePart,
        milestones,
        completedCount: completed,
        isActive: num === firstIncompletePhase,
        isComplete: completed === milestones.length,
      }
    })
}

function PhaseGroup({
  phase,
  runState,
  expanded,
  onToggle,
  onBuild,
  onMarkComplete,
}: {
  phase: PhaseGroupData
  runState: PhaseRunState
  expanded: boolean
  onToggle: () => void
  onBuild: (id: string) => void
  onMarkComplete: (id: string) => void
}) {
  const pct = phase.milestones.length > 0
    ? Math.round((phase.completedCount / phase.milestones.length) * 100)
    : 0

  return (
    <div className={`border-b border-zinc-800/60 ${phase.isActive ? 'bg-zinc-800/20' : ''}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-zinc-800/30"
      >
        <PhaseIcon isComplete={phase.isComplete} isActive={phase.isActive} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${phase.isActive ? 'text-zinc-200' : phase.isComplete ? 'text-zinc-500' : 'text-zinc-400'}`}>
              Phase {phase.phaseNumber}: {phase.phaseName}
            </span>
            {phase.isActive && (
              <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-400">
                active
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all ${phase.isComplete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-600">
              {phase.completedCount}/{phase.milestones.length}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600" />
        )}
      </button>

      {expanded && (
        <div className="pb-2">
          {phase.milestones.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              runState={runState}
              onBuild={onBuild}
              onMarkComplete={onMarkComplete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PhaseIcon({ isComplete, isActive }: { isComplete: boolean; isActive: boolean }) {
  if (isComplete) return <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
  if (isActive) return <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-indigo-400 bg-indigo-400/20" />
  return <Circle className="h-4 w-4 flex-shrink-0 text-zinc-700" />
}

// ── Milestone row ──────────────────────────────────────────────────────────

function MilestoneRow({
  milestone,
  runState,
  onBuild,
  onMarkComplete,
}: {
  milestone: OrderedMilestone
  runState: PhaseRunState
  onBuild: (id: string) => void
  onMarkComplete: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const isRunning = runState.currentMilestoneId === milestone.id && runState.status === 'building'

  return (
    <div
      className={`group flex items-start gap-3 px-6 py-2 ${isRunning ? 'bg-indigo-950/30' : 'hover:bg-zinc-800/20'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Status icon */}
      <div className="mt-0.5 flex-shrink-0">
        {milestone.checked ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
        ) : (
          <div className="h-3.5 w-3.5 rounded-sm border border-zinc-700" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs ${milestone.checked ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
            {milestone.text}
          </span>
          <ComplexityBadge complexity={milestone.complexity} />
          {milestone.suggestedCheckpoint && (
            <span title={milestone.checkpointReason ?? ''} className="flex items-center gap-0.5 text-[9px] font-medium text-amber-400">
              <Zap className="h-2.5 w-2.5" /> checkpoint
            </span>
          )}
        </div>

        {milestone.specPath && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-600">
            <FileCode className="h-2.5 w-2.5" />
            {milestone.specPath.split('/').pop()}
          </div>
        )}

        {milestone.rationale && hovered && !milestone.checked && (
          <p className="mt-1 text-[10px] italic text-zinc-600">{milestone.rationale}</p>
        )}
      </div>

      {/* Actions */}
      {!milestone.checked && (hovered || isRunning) && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={() => onBuild(milestone.id)}
            title="Pre-fill chat with kickoff prompt"
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-indigo-400 hover:bg-indigo-500/10"
          >
            <ArrowRight className="h-3 w-3" /> Build
          </button>
          <button
            onClick={() => onMarkComplete(milestone.id)}
            title="Mark as complete"
            className="rounded px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}

function ComplexityBadge({ complexity }: { complexity: OrderedMilestone['complexity'] }) {
  const colors = {
    low: 'text-emerald-600',
    medium: 'text-amber-600',
    high: 'text-red-500',
  }
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wide ${colors[complexity]}`}>
      {complexity}
    </span>
  )
}

// ── Run config modal ───────────────────────────────────────────────────────

function RunConfigModal({
  plan,
  batchSize,
  onBatchSizeChange,
  onConfirm,
  onCancel,
}: {
  plan: PhasePlan
  batchSize: number
  onBatchSizeChange: (n: number) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const checkpoints = plan.milestones.filter((m) => !m.checked && m.suggestedCheckpoint)
  const nextMilestone = plan.milestones.find((m) => !m.checked)
  const options = [
    { value: 1, label: '1 milestone' },
    { value: 3, label: '3 milestones' },
    { value: 5, label: '5 milestones' },
    { value: 0, label: 'Until next checkpoint' },
    { value: -1, label: 'All remaining' },
  ]

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-xl">
      <div className="w-[380px] rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h3 className="text-sm font-semibold text-zinc-200">Configure phase run</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          Sneebly will build milestones autonomously, running self-review after each one.
        </p>

        {nextMilestone && (
          <div className="mt-4 rounded-lg bg-zinc-800 px-3 py-2">
            <div className="text-[10px] text-zinc-500">Starting with</div>
            <div className="mt-0.5 text-xs text-zinc-300">{nextMilestone.text}</div>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Build how many before checking in?
          </div>
          <div className="grid grid-cols-3 gap-2">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onBatchSizeChange(opt.value)}
                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                  batchSize === opt.value
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {checkpoints.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-600">
              Suggested checkpoints
            </div>
            <div className="flex flex-col gap-1">
              {checkpoints.slice(0, 3).map((m) => (
                <div key={m.id} className="flex items-start gap-1.5 text-[10px] text-zinc-500">
                  <Zap className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-amber-600" />
                  <span>{m.text} — {m.checkpointReason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Run status bar ─────────────────────────────────────────────────────────

function RunStatusBar({
  runState,
  activeMilestone,
}: {
  runState: PhaseRunState
  activeMilestone: OrderedMilestone | undefined
}) {
  const statusColors: Record<string, string> = {
    building: 'text-indigo-400',
    paused: 'text-zinc-400',
    complete: 'text-emerald-400',
  }
  const color = statusColors[runState.status] ?? 'text-zinc-400'

  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-800/30 px-6 py-2">
      {runState.status === 'building' && (
        <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
      )}
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-medium ${color}`}>
          {runState.status === 'building' && 'Building'}
          {runState.status === 'paused' && 'Paused'}
          {runState.status === 'complete' && 'All done'}
        </span>
        {activeMilestone && runState.status === 'building' && (
          <span className="ml-2 text-xs text-zinc-500 truncate">{activeMilestone.text}</span>
        )}
        {runState.completedInBatch > 0 && (
          <span className="ml-2 text-[10px] text-zinc-600">
            {runState.completedInBatch} built this run
          </span>
        )}
      </div>
      {runState.lastError && (
        <span className="text-[10px] text-red-400 truncate max-w-[200px]">
          {runState.lastError}
        </span>
      )}
    </div>
  )
}

// ── Audit progress bar ─────────────────────────────────────────────────────

function AuditProgressBar({
  progress,
  onDismiss,
}: {
  progress: PhaseAuditProgress
  onDismiss: () => void
}) {
  if (progress.stage === 'running') {
    const pct = progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0
    return (
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-800/20 px-6 py-2">
        <Loader2 className="h-3 w-3 animate-spin flex-shrink-0 text-indigo-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-indigo-400">Auditing codebase</span>
            <span className="text-[10px] text-zinc-600">{progress.checked}/{progress.total}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 w-32 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-zinc-600 truncate max-w-[280px]">{progress.currentMilestone}</span>
          </div>
        </div>
      </div>
    )
  }

  const completeCount = progress.results.filter((r) => r.status === 'complete').length
  const partialCount = progress.results.filter((r) => r.status === 'partial').length

  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-zinc-800 bg-emerald-950/20 px-6 py-2">
      <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-500" />
      <div className="flex-1 text-xs">
        <span className="font-medium text-emerald-400">Audit complete</span>
        <span className="ml-2 text-zinc-500">
          {progress.appliedCount} milestone{progress.appliedCount !== 1 ? 's' : ''} marked complete
          {partialCount > 0 && ` · ${partialCount} partial`}
          {completeCount > progress.appliedCount && ` · ${completeCount - progress.appliedCount} complete (low confidence, not auto-checked)`}
        </span>
      </div>
      <button onClick={onDismiss} className="text-zinc-600 hover:text-zinc-400">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Test checklist card ────────────────────────────────────────────────────

function ChecklistCard({ items, onDismiss }: { items: string[]; onDismiss: () => void }) {
  const [checked, setChecked] = useState<Set<number>>(new Set())

  return (
    <div className="mx-6 mt-3 flex-shrink-0 rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
          <ClipboardList className="h-3 w-3" />
          Verify before continuing
        </div>
        <button
          onClick={onDismiss}
          className="text-zinc-600 hover:text-zinc-400"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <label key={i} className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checked.has(i)}
              onChange={() =>
                setChecked((prev) => {
                  const next = new Set(prev)
                  if (next.has(i)) next.delete(i)
                  else next.add(i)
                  return next
                })
              }
              className="mt-0.5 h-3 w-3 rounded accent-amber-500"
            />
            <span className={`text-[11px] ${checked.has(i) ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
              {item}
            </span>
          </label>
        ))}
      </div>
      {checked.size === items.length && (
        <div className="mt-2 text-[10px] text-emerald-400">
          All items verified — ready to continue
        </div>
      )}
    </div>
  )
}

// ── Empty / loading states ─────────────────────────────────────────────────

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
      <div className="text-center">
        <h3 className="text-sm font-medium text-zinc-300">No phase plan yet</h3>
        <p className="mt-1 text-xs text-zinc-600 max-w-xs">
          Sneebly will read your GOALS.md and all spec files, analyze dependencies, and produce
          an ordered build sequence with kickoff prompts for every milestone.
        </p>
      </div>
      <button
        onClick={onGenerate}
        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        <Zap className="h-4 w-4" />
        Generate build order
      </button>
    </div>
  )
}

function GeneratingState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-300">Analyzing specs…</p>
        <p className="mt-1 text-xs text-zinc-600">
          Claude is reading your specs and planning the build order
        </p>
      </div>
    </div>
  )
}

// ── Shell helpers ──────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>
  )
}

function PanelShell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode
  onClose: () => void
  title: string
}) {
  return (
    <div className="relative flex w-[700px] max-h-[85vh] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
          <p className="mt-0.5 text-[10px] text-zinc-600">
            AI-ordered build sequence · click Build to prefill chat · Start run for autonomous mode
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  )
}
