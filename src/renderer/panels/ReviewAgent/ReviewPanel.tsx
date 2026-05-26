import { useState } from 'react'
import { X, Loader2, Check, Copy, ArrowRightToLine, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import type { ReviewOutput, ReviewLensFinding } from '../../../shared/types'
import { useReviewAgentStore } from './useReviewAgentStore'
import { useProjectStore } from '../../state/projectStore'
import { useChatStore } from '../../state/chatStore'
import { useEditorStore } from '../../state/editorStore'

const VERDICT_STYLE: Record<ReviewOutput['verdict'], string> = {
  complete: 'text-emerald-400',
  partial: 'text-amber-400',
  broken: 'text-rose-400',
}

const SEVERITY_STYLE: Record<ReviewLensFinding['severity'], string> = {
  critical: 'text-rose-400',
  significant: 'text-amber-400',
  minor: 'text-zinc-500',
}

export default function ReviewPanel() {
  const modalOpen = useReviewAgentStore((s) => s.modalOpen)
  const current = useReviewAgentStore((s) => s.current)
  const cancelCurrent = useReviewAgentStore((s) => s.cancelCurrent)
  const closeModal = useReviewAgentStore((s) => s.closeModal)

  if (!modalOpen || !current) return null

  // z-[55]: above the PhasePanel (z-50) it's launched from, below the editor (z-60)
  // so "view in editor" opens on top of the review rather than behind it.
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[85vh] w-[640px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <span className="text-sm font-medium text-zinc-200">
            Review: {current.milestoneId} — {current.milestoneText}
          </span>
          <div className="flex items-center gap-1">
            {/* turnId === null means we're showing a cached result — offer a fresh run. */}
            {current.status === 'done' && current.turnId === null && (
              <button
                onClick={() => useReviewAgentStore.getState().rerun()}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
              >
                <RefreshCw className="h-3 w-3" /> Re-run review
              </button>
            )}
            <button onClick={current.status === 'thinking' ? cancelCurrent : closeModal} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-xs">
          {current.status === 'thinking' && <Thinking lines={current.thinking} onCancel={cancelCurrent} />}
          {current.status === 'error' && (
            <div className="text-rose-400">Review failed: {current.error}</div>
          )}
          {current.status === 'done' && current.result && (
            <ReviewResult result={current.result} projectId={current.projectId} milestoneId={current.milestoneId} />
          )}
        </div>
      </div>
    </div>
  )
}

function Thinking({ lines, onCancel }: { lines: string[]; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-zinc-300">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
        Reviewing… (this takes 30-60s)
      </div>
      <div className="space-y-0.5 pl-6">
        {lines.slice(-6).map((l, i) => (
          <div key={i} className="italic text-zinc-600">{l}</div>
        ))}
      </div>
      <button onClick={onCancel} className="mt-2 self-start rounded px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
        Cancel
      </button>
    </div>
  )
}

function ReviewResult({ result, projectId, milestoneId }: { result: ReviewOutput; projectId: string; milestoneId: string }) {
  const satisfied = result.specMatch.filter((c) => c.satisfied).length
  return (
    <div className="flex flex-col gap-4">
      {/* Verdict */}
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold uppercase ${VERDICT_STYLE[result.verdict]}`}>{result.verdict}</span>
        <span className="text-zinc-500">· confidence: {result.confidence}</span>
      </div>

      {/* Spec criteria */}
      {result.specMatch.length > 0 && (
        <div className="rounded-lg border border-zinc-800 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Spec criteria ({satisfied} of {result.specMatch.length} satisfied)
          </div>
          <div className="flex flex-col gap-1">
            {result.specMatch.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5" title={c.evidence ?? ''}>
                <span className={c.satisfied ? 'text-emerald-500' : 'text-rose-500'}>{c.satisfied ? '✓' : '✗'}</span>
                <span className="text-zinc-300">{c.criterion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lens findings */}
      {result.eightLensFindings.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Findings ({result.eightLensFindings.length})
          </div>
          <div className="flex flex-col gap-2">
            {result.eightLensFindings.map((f, i) => (
              <Finding key={i} finding={f} projectId={projectId} />
            ))}
          </div>
        </div>
      )}

      {/* Recommended action */}
      <RecommendedAction result={result} projectId={projectId} milestoneId={milestoneId} />

      <Collapsible title={`Non-blocking observations (${result.nonBlockingObservations.length})`} items={result.nonBlockingObservations} />
      <Collapsible title={`Uncertainty flags (${result.uncertaintyFlags.length})`} items={result.uncertaintyFlags} />

      {result.rawText && (
        <Collapsible title="Raw model output (parse failed)" items={[result.rawText]} mono />
      )}
    </div>
  )
}

function Finding({ finding, projectId }: { finding: ReviewLensFinding; projectId: string }) {
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === projectId) ?? null)
  const openFile = useEditorStore((s) => s.openFile)

  function viewInEditor() {
    if (!activeProject) return
    const path = finding.fileLine.split(':')[0]
    const rel = path.startsWith(activeProject.path + '/') ? path.slice(activeProject.path.length + 1) : path
    openFile(activeProject.path, activeProject.id, rel)
  }

  return (
    <div className="rounded border border-zinc-800 p-2">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">Lens {finding.lens}</span>
        <span className={`font-semibold uppercase ${SEVERITY_STYLE[finding.severity]}`}>{finding.severity}</span>
        {finding.verificationRequired && <span className="text-[9px] text-amber-500">verify</span>}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{finding.fileLine}</div>
      <div className="mt-0.5 text-zinc-300">{finding.description}</div>
      {finding.fileLine.includes(':') && (
        <button onClick={viewInEditor} className="mt-1 text-[10px] text-indigo-400 hover:underline">
          view in editor
        </button>
      )}
    </div>
  )
}

function RecommendedAction({ result, projectId, milestoneId }: { result: ReviewOutput; projectId: string; milestoneId: string }) {
  const action = result.recommendedAction
  const setComposerText = useChatStore((s) => s.setComposerText)
  const closeModal = useReviewAgentStore((s) => s.closeModal)
  const [copied, setCopied] = useState(false)

  function record(a: string) {
    const reviewId = useReviewAgentStore.getState().current?.turnId ?? ''
    window.api.reviewAgentRecordAction({ projectId, milestoneId, action: a, reviewId }).catch(() => {})
  }

  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Recommended: {action.type}
      </div>
      <div className="text-zinc-300">{action.reason}</div>

      {action.type === 'refine' && (
        <>
          <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300">
            {action.kickoffPrompt}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(action.kickoffPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500); record('copy') }}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => { setComposerText(action.kickoffPrompt); record('paste'); closeModal() }}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-500"
            >
              <ArrowRightToLine className="h-3 w-3" /> Paste into chat
            </button>
          </div>
          <p className="mt-1 text-[9px] text-zinc-600">Paste drops it in the chat composer — edit before sending.</p>
        </>
      )}

      {action.type === 'escalate' && action.questionsForUser.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-zinc-400">
          {action.questionsForUser.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      )}
      {action.type === 'rollback' && (
        <div className="mt-1 font-mono text-[10px] text-zinc-500">target: {action.rollbackTarget}</div>
      )}
    </div>
  )
}

function Collapsible({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-300">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && (
        <div className={`mt-1 flex flex-col gap-1 pl-4 ${mono ? 'whitespace-pre-wrap font-mono text-[10px]' : ''} text-zinc-400`}>
          {items.map((it, i) => <div key={i}>{mono ? it : `• ${it}`}</div>)}
        </div>
      )}
    </div>
  )
}
