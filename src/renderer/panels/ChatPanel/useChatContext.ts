import { useEffect, useMemo, useState } from 'react'
import type { PhaseRunState, PhasePlan, ReadCard, EditCard, WriteCard } from '../../../shared/types'
import { useProjectStore } from '../../state/projectStore'
import { useChatStore } from '../../state/chatStore'
import { useActivityStore } from '../../state/activityStore'

export interface ChatContextInfo {
  label: string
  tooltip: string
  kind: 'milestone' | 'spec' | 'file' | 'general'
  filePath: string | null // spec/file to open on click (null = not clickable)
}

const MILESTONE_RE = /p\d+-m\d+/
const RECENT_MESSAGES = 5

function findLast<T, S extends T>(arr: readonly T[], pred: (x: T) => x is S): S | undefined
function findLast<T>(arr: readonly T[], pred: (x: T) => boolean): T | undefined
function findLast<T>(arr: readonly T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i]
  }
  return undefined
}

function fileName(p: string): string {
  return p.split('/').pop() || p
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// Heuristic, no-LLM context inference. Priority: active phase milestone > recent spec
// read > milestone id in recent messages > recent file edit > general.
export function useChatContext(): ChatContextInfo {
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const messages = useChatStore((s) => s.messages)
  const cards = useActivityStore((s) => s.cards)
  const [runState, setRunState] = useState<PhaseRunState | null>(null)
  const [plan, setPlan] = useState<PhasePlan | null>(null)

  useEffect(() => {
    if (!activeProjectId) {
      setRunState(null)
      setPlan(null)
      return
    }
    window.api.phaseRunState(activeProjectId).then(setRunState).catch(() => {})
    window.api.phasePlanGet(activeProjectId).then(setPlan).catch(() => {})
    return window.api.phaseOnRunStateChanged((pid, state) => {
      if (pid === activeProjectId) setRunState(state)
    })
  }, [activeProjectId])

  return useMemo<ChatContextInfo>(() => {
    // 1. Phase runner working/paused on a milestone
    if (
      runState &&
      (runState.status === 'building' || runState.status === 'paused') &&
      runState.currentMilestoneId
    ) {
      const id = runState.currentMilestoneId
      const m = plan?.milestones.find((x) => x.id === id)
      return {
        label: m?.text ? `${id} — ${truncate(m.text, 28)}` : id,
        tooltip: `Active milestone (phase runner): ${id}${m?.text ? ` — ${m.text}` : ''}`,
        kind: 'milestone',
        filePath: m?.specPath ?? null,
      }
    }

    // 2. Most recent spec file read
    const specRead = findLast(
      cards,
      (c): c is ReadCard =>
        c.cardType === 'read' && /spec/i.test((c as ReadCard).filePath) && /\.md$/i.test((c as ReadCard).filePath)
    )
    if (specRead) {
      return {
        label: fileName(specRead.filePath),
        tooltip: `Most recent spec file read: ${specRead.filePath}`,
        kind: 'spec',
        filePath: specRead.filePath,
      }
    }

    // 3. Milestone id mentioned in recent messages
    for (const msg of messages.slice(-RECENT_MESSAGES).reverse()) {
      const match = msg.text.match(MILESTONE_RE)
      if (match) {
        return {
          label: match[0],
          tooltip: `Milestone mentioned in a recent message: ${match[0]}`,
          kind: 'milestone',
          filePath: plan?.milestones.find((x) => x.id === match[0])?.specPath ?? null,
        }
      }
    }

    // 4. Most recently edited file
    const edit = findLast(
      cards,
      (c): c is EditCard | WriteCard => c.cardType === 'edit' || c.cardType === 'write'
    )
    if (edit) {
      return {
        label: fileName(edit.filePath),
        tooltip: `Most recently edited file: ${edit.filePath}`,
        kind: 'file',
        filePath: edit.filePath,
      }
    }

    // 5. Fallback
    return {
      label: 'general',
      tooltip: 'No recent spec, milestone, or file activity',
      kind: 'general',
      filePath: null,
    }
  }, [runState, plan, cards, messages])
}
