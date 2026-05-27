import { useEffect } from 'react'
import { useDeciderStore } from '../../state/deciderStore'

interface Props {
  projectId: string | null
}

/**
 * Self-contained badge that reads from useDeciderStore directly.
 * Subscribes to DECIDER_DECISIONS_UPDATED push events and re-fetches the
 * flagged count (medium + high risk decisions) on each update.
 *
 * Renders nothing when count is zero or projectId is null.
 */
export default function DecisionsBadge({ projectId }: Props) {
  const flaggedCount = useDeciderStore((s) => s.flaggedCount)
  const refreshFlaggedCount = useDeciderStore((s) => s.refreshFlaggedCount)

  // Initial fetch when projectId changes
  useEffect(() => {
    if (projectId) void refreshFlaggedCount(projectId)
  }, [projectId, refreshFlaggedCount])

  // Subscribe to push events from main
  useEffect(() => {
    if (!projectId) return
    const unsub = window.api.deciderOnDecisionsUpdated((updatedProjectId) => {
      if (updatedProjectId === projectId) {
        void refreshFlaggedCount(projectId)
      }
    })
    return unsub
  }, [projectId, refreshFlaggedCount])

  if (!projectId || flaggedCount === 0) return null

  return (
    <span
      title={`${flaggedCount} Decider decision${flaggedCount === 1 ? '' : 's'} flagged (medium/high risk)`}
      className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400"
    >
      {flaggedCount}
    </span>
  )
}
