import { useState, useEffect } from 'react'
import { X, CheckCircle, XCircle, RotateCcw, Play, ChevronDown, ChevronUp } from 'lucide-react'
import { useLearningsStore } from '../../state/learningsStore'
import type { PendingLearning, PromotedLearning, ShadowResult } from '../../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string | null
}

export default function LearningsPanel({ open, onClose, projectId }: Props) {
  if (!open || !projectId) return null
  return <LearningsPanelInner onClose={onClose} projectId={projectId} />
}

type Tab = 'inbox' | 'open-questions' | 'conventions' | 'active'

function LearningsPanelInner({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const [tab, setTab] = useState<Tab>('inbox')
  const { pending, promoted, loading, shadowRunningId, load, promote, reject, revert, runShadow } =
    useLearningsStore()

  useEffect(() => {
    load(projectId)
  }, [projectId])

  const inboxPending = pending.filter((e) => !e.targetScope || e.targetScope === 'system-prompt')
  const openQuestionsPending = pending.filter((e) => e.targetScope === 'goals-md')
  const conventionsPending = pending.filter((e) => e.targetScope === 'conventions-md')
  const conventionsActive = promoted.filter((e) => e.targetScope === 'conventions-md')
  const activePromoted = promoted.filter((e) => !e.targetScope || e.targetScope === 'system-prompt')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex w-[640px] max-h-[80vh] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Learnings Inbox</h2>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Proposed improvements from your session reflections
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-shrink-0 border-b border-zinc-800 px-6">
          <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>
            Inbox
            {inboxPending.length > 0 && (
              <Badge count={inboxPending.length} color="purple" />
            )}
          </TabButton>
          <TabButton active={tab === 'open-questions'} onClick={() => setTab('open-questions')}>
            Open Questions
            {openQuestionsPending.length > 0 && (
              <Badge count={openQuestionsPending.length} color="blue" />
            )}
          </TabButton>
          <TabButton active={tab === 'conventions'} onClick={() => setTab('conventions')}>
            Conventions
            {conventionsPending.length > 0 && (
              <Badge count={conventionsPending.length} color="amber" />
            )}
          </TabButton>
          <TabButton active={tab === 'active'} onClick={() => setTab('active')}>
            Active
            {activePromoted.length > 0 && (
              <Badge count={activePromoted.length} color="green" />
            )}
          </TabButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <p className="text-[10px] text-zinc-600 py-4 text-center">Loading…</p>
          ) : tab === 'inbox' ? (
            inboxPending.length === 0 ? (
              <EmptyState
                message="No pending learnings"
                detail="Learnings appear after sessions with 3+ friction events, when nightly reflections are enabled."
              />
            ) : (
              inboxPending.map((entry) => (
                <PendingCard
                  key={entry.id}
                  entry={entry}
                  shadowRunningId={shadowRunningId}
                  onPromote={() => promote(projectId, entry.id)}
                  onReject={() => reject(projectId, entry.id)}
                  onRunShadow={() => runShadow(projectId, entry.id)}
                />
              ))
            )
          ) : tab === 'open-questions' ? (
            openQuestionsPending.length === 0 ? (
              <EmptyState
                message="No open questions"
                detail="Questions appear when reflections detect a recurring unresolved problem that is not already in GOALS.md."
              />
            ) : (
              openQuestionsPending.map((entry) => (
                <OpenQuestionCard
                  key={entry.id}
                  entry={entry}
                  onPromote={() => promote(projectId, entry.id)}
                  onReject={() => reject(projectId, entry.id)}
                />
              ))
            )
          ) : tab === 'conventions' ? (
            conventionsPending.length === 0 && conventionsActive.length === 0 ? (
              <EmptyState
                message="No conventions detected"
                detail="Conventions are auto-detected from your editing patterns weekly. Package manager, test command, and indent style are tracked."
              />
            ) : (
              <>
                {conventionsPending.map((entry) => (
                  <ConventionPendingCard
                    key={entry.id}
                    entry={entry}
                    oldConvention={promoted.find((p) => p.id === entry.supersedes) ?? null}
                    onPromote={() => promote(projectId, entry.id)}
                    onReject={() => reject(projectId, entry.id)}
                  />
                ))}
                {conventionsActive.map((entry) => (
                  <ConventionActiveCard
                    key={entry.id}
                    entry={entry}
                    onRevert={() => revert(projectId, entry.id)}
                  />
                ))}
              </>
            )
          ) : activePromoted.length === 0 ? (
            <EmptyState
              message="No active learnings"
              detail="Learnings you approve move here and are injected into the system prompt on each new session."
            />
          ) : (
            activePromoted.map((entry) => (
              <PromotedCard
                key={entry.id}
                entry={entry}
                onRevert={() => revert(projectId, entry.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Badge({ count, color }: { count: number; color: 'purple' | 'green' | 'blue' | 'amber' }) {
  const styles = {
    purple: 'bg-purple-800/60 text-purple-300',
    green: 'bg-green-900/60 text-green-400',
    blue: 'bg-blue-900/60 text-blue-400',
    amber: 'bg-amber-900/60 text-amber-400',
  }
  return (
    <span className={`ml-1.5 rounded-full px-1.5 text-[9px] font-semibold ${styles[color]}`}>
      {count}
    </span>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center px-1 py-3 text-xs font-medium border-b-2 -mb-px transition-colors mr-4',
        active
          ? 'border-zinc-400 text-zinc-200'
          : 'border-transparent text-zinc-500 hover:text-zinc-300',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function EmptyState({ message, detail }: { message: string; detail: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-zinc-500">{message}</p>
      <p className="mt-1 text-[10px] text-zinc-700 max-w-xs mx-auto">{detail}</p>
    </div>
  )
}

function PendingCard({
  entry,
  shadowRunningId,
  onPromote,
  onReject,
  onRunShadow,
}: {
  entry: PendingLearning
  shadowRunningId: string | null
  onPromote: () => void
  onReject: () => void
  onRunShadow: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isShadowRunning = shadowRunningId === entry.id
  const canRunShadow = entry.shadowRuns.length < 3 && !shadowRunningId

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 leading-snug">{entry.title}</p>
            {entry.rationale && (
              <p className="mt-0.5 text-[10px] text-zinc-500 leading-relaxed">{entry.rationale}</p>
            )}
          </div>
          <span className="text-[9px] font-mono text-zinc-700 flex-shrink-0 pt-0.5">
            {entry.sourceReflectionDate}
          </span>
        </div>

        <div className="mt-2.5 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 font-medium">Proposed prompt addition</p>
          <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{entry.proposedChange}</p>
        </div>

        {entry.shadowRuns.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {entry.shadowRuns.length} shadow {entry.shadowRuns.length === 1 ? 'run' : 'runs'}
            </button>
            {expanded && (
              <div className="mt-2 space-y-2">
                {entry.shadowRuns.map((run, i) => (
                  <ShadowRunCard key={i} run={run} index={i} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onPromote}
            className="flex items-center gap-1.5 rounded-md bg-green-900/40 border border-green-800/40 px-2.5 py-1.5 text-xs font-medium text-green-400 hover:bg-green-900/70 transition-colors"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Promote
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
          {canRunShadow && (
            <button
              onClick={onRunShadow}
              className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              <Play className="h-3 w-3" />
              Run shadow
            </button>
          )}
          {isShadowRunning && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-purple-400">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
              Shadow running…
            </span>
          )}
          {entry.shadowRuns.length >= 3 && (
            <span className="ml-auto text-[10px] text-zinc-700">Max shadow runs reached</span>
          )}
        </div>
      </div>
    </div>
  )
}

function OpenQuestionCard({
  entry,
  onPromote,
  onReject,
}: {
  entry: PendingLearning
  onPromote: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 leading-snug">{entry.proposedChange}</p>
            {entry.rationale && (
              <p className="mt-0.5 text-[10px] text-zinc-500 leading-relaxed">{entry.rationale}</p>
            )}
          </div>
          <span className="text-[9px] font-mono text-zinc-700 flex-shrink-0 pt-0.5">
            {entry.sourceReflectionDate}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onPromote}
            className="flex items-center gap-1.5 rounded-md bg-blue-900/40 border border-blue-800/40 px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-900/70 transition-colors"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Add to GOALS.md
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

function ConventionPendingCard({
  entry,
  oldConvention,
  onPromote,
  onReject,
}: {
  entry: PendingLearning
  oldConvention: PromotedLearning | null
  onPromote: () => void
  onReject: () => void
}) {
  const isSupersession = !!entry.supersedes

  return (
    <div className="rounded-lg border border-amber-900/40 bg-zinc-950 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-zinc-200 leading-snug">{entry.title}</p>
              {isSupersession && (
                <span className="text-[9px] rounded bg-amber-900/50 border border-amber-800/50 px-1.5 py-0.5 text-amber-400 font-medium">
                  update
                </span>
              )}
            </div>
            {entry.rationale && (
              <p className="mt-0.5 text-[10px] text-zinc-500 leading-relaxed">{entry.rationale}</p>
            )}
          </div>
          <span className="text-[9px] font-mono text-zinc-700 flex-shrink-0 pt-0.5">
            {entry.sourceReflectionDate}
          </span>
        </div>

        {isSupersession && oldConvention ? (
          <div className="mt-2.5 space-y-1.5">
            <div className="rounded-md bg-red-950/30 border border-red-900/30 px-3 py-2">
              <p className="text-[10px] text-red-500/70 uppercase tracking-wide mb-1 font-medium">Current</p>
              <p className="text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap line-through decoration-red-900/60">{oldConvention.proposedChange}</p>
            </div>
            <div className="rounded-md bg-green-950/20 border border-green-900/30 px-3 py-2">
              <p className="text-[10px] text-green-600/70 uppercase tracking-wide mb-1 font-medium">Updated</p>
              <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{entry.proposedChange}</p>
            </div>
          </div>
        ) : (
          <div className="mt-2.5 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 font-medium">Detected convention</p>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{entry.proposedChange}</p>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onPromote}
            className="flex items-center gap-1.5 rounded-md bg-amber-900/40 border border-amber-800/40 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-900/70 transition-colors"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Apply
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}

function ConventionActiveCard({
  entry,
  onRevert,
}: {
  entry: PromotedLearning
  onRevert: () => void
}) {
  return (
    <div className="rounded-lg border border-zinc-700/40 bg-zinc-950 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-300 leading-snug">{entry.title}</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Applied {new Date(entry.promotedAt).toLocaleDateString()}
            </p>
          </div>
          <span className="text-[9px] rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-500 font-medium">active</span>
        </div>

        <div className="mt-2 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2">
          <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{entry.proposedChange}</p>
        </div>

        <div className="mt-3">
          <button
            onClick={onRevert}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

function ShadowRunCard({ run, index }: { run: ShadowResult; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-[10px] text-zinc-500 hover:text-zinc-300"
      >
        <span>Run #{index + 1} · {new Date(run.ranAt).toLocaleDateString()} · {run.tokensIn + run.tokensOut} tokens</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <p className="mt-2 text-[10px] text-zinc-400 whitespace-pre-wrap leading-relaxed">{run.assistantText}</p>
      )}
    </div>
  )
}

function PromotedCard({
  entry,
  onRevert,
}: {
  entry: PromotedLearning
  onRevert: () => void
}) {
  return (
    <div className="rounded-lg border border-green-900/40 bg-zinc-950 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 leading-snug">{entry.title}</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Promoted {new Date(entry.promotedAt).toLocaleDateString()} · from {entry.sourceReflectionDate}
            </p>
          </div>
        </div>

        <div className="mt-2.5 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2">
          <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{entry.proposedChange}</p>
        </div>

        <div className="mt-3">
          <button
            onClick={onRevert}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Revert
          </button>
        </div>
      </div>
    </div>
  )
}
