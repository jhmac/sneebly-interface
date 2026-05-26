import { create } from 'zustand'
import type { ReviewOutput } from '../../../shared/types'

interface CurrentReview {
  projectId: string
  milestoneId: string
  milestoneText: string
  turnId: string | null // null when viewing a cached result (enables the Re-run button)
  status: 'thinking' | 'done' | 'error'
  thinking: string[]
  result?: ReviewOutput
  error?: string
}

interface CachedReview {
  result: ReviewOutput
  completedAt: number
}

interface ReviewAgentStore {
  current: CurrentReview | null
  modalOpen: boolean
  reviewsByMilestoneId: Record<string, CachedReview>
  inFlightByMilestoneId: Record<string, boolean>

  startReview: (projectId: string, milestoneId: string, milestoneText: string) => Promise<void>
  viewCached: (projectId: string, milestoneId: string, milestoneText: string) => void
  rerun: () => void
  cancelCurrent: () => void
  closeModal: () => void
  clearForProject: () => void

  _onThinking: (turnId: string, milestoneId: string, status: string) => void
  _onDone: (turnId: string, milestoneId: string, result?: ReviewOutput, error?: string) => void
}

export const useReviewAgentStore = create<ReviewAgentStore>((set, get) => ({
  current: null,
  modalOpen: false,
  reviewsByMilestoneId: {},
  inFlightByMilestoneId: {},

  startReview: async (projectId, milestoneId, milestoneText) => {
    set({
      modalOpen: true,
      current: { projectId, milestoneId, milestoneText, turnId: null, status: 'thinking', thinking: [] },
    })
    try {
      const { turnId } = await window.api.reviewAgentStart({ projectId, milestoneId })
      set((s) => (s.current ? { current: { ...s.current, turnId } } : s))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((s) => (s.current ? { current: { ...s.current, status: 'error', error: message } } : s))
    }
  },

  viewCached: (projectId, milestoneId, milestoneText) => {
    const cached = get().reviewsByMilestoneId[milestoneId]
    if (!cached) return
    set({
      modalOpen: true,
      current: { projectId, milestoneId, milestoneText, turnId: null, status: 'done', thinking: [], result: cached.result },
    })
  },

  rerun: () => {
    const c = get().current
    if (!c) return
    get().startReview(c.projectId, c.milestoneId, c.milestoneText)
  },

  cancelCurrent: () => {
    const turnId = get().current?.turnId
    if (turnId) window.api.reviewAgentCancel(turnId).catch(() => {})
    set({ modalOpen: false, current: null })
  },

  closeModal: () => set({ modalOpen: false }),

  clearForProject: () => set({ reviewsByMilestoneId: {}, inFlightByMilestoneId: {}, current: null, modalOpen: false }),

  _onThinking: (turnId, milestoneId, status) => {
    set((s) => {
      const patch: Partial<ReviewAgentStore> = {}
      // Only recreate the map on the first thinking event — avoids re-rendering the
      // whole milestone list on every subsequent tool call.
      if (!s.inFlightByMilestoneId[milestoneId]) {
        patch.inFlightByMilestoneId = { ...s.inFlightByMilestoneId, [milestoneId]: true }
      }
      if (s.current && s.current.turnId === turnId) {
        patch.current = { ...s.current, thinking: [...s.current.thinking, status] }
      }
      return patch
    })
  },

  _onDone: (turnId, milestoneId, result, error) => {
    set((s) => {
      const inFlight = { ...s.inFlightByMilestoneId }
      delete inFlight[milestoneId]

      const reviews = { ...s.reviewsByMilestoneId }
      if (result) reviews[milestoneId] = { result, completedAt: Date.now() }

      // Update the modal only if it's showing this turn.
      let current = s.current
      if (current && current.turnId === turnId) {
        if (error === 'cancelled') current = null
        else if (error) current = { ...current, status: 'error', error }
        else current = { ...current, status: 'done', result }
      }
      return { inFlightByMilestoneId: inFlight, reviewsByMilestoneId: reviews, current }
    })
  },
}))
