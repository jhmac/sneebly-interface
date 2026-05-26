import { create } from 'zustand'
import type { ReviewOutput } from '../../../shared/types'

interface CurrentReview {
  projectId: string
  milestoneId: string
  milestoneText: string
  turnId: string | null
  status: 'thinking' | 'done' | 'error'
  thinking: string[]
  result?: ReviewOutput
  error?: string
}

interface ReviewAgentStore {
  current: CurrentReview | null
  modalOpen: boolean

  startReview: (projectId: string, milestoneId: string, milestoneText: string) => Promise<void>
  cancelCurrent: () => void
  closeModal: () => void

  _onThinking: (turnId: string, status: string) => void
  _onDone: (turnId: string, result?: ReviewOutput, error?: string) => void
}

export const useReviewAgentStore = create<ReviewAgentStore>((set, get) => ({
  current: null,
  modalOpen: false,

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

  cancelCurrent: () => {
    const turnId = get().current?.turnId
    if (turnId) window.api.reviewAgentCancel(turnId).catch(() => {})
    set({ modalOpen: false, current: null })
  },

  closeModal: () => set({ modalOpen: false }),

  _onThinking: (turnId, status) => {
    set((s) => {
      if (!s.current || s.current.turnId !== turnId) return s
      return { current: { ...s.current, thinking: [...s.current.thinking, status] } }
    })
  },

  _onDone: (turnId, result, error) => {
    set((s) => {
      if (!s.current || s.current.turnId !== turnId) return s
      if (error === 'cancelled') return { current: null, modalOpen: false }
      if (error) return { current: { ...s.current, status: 'error', error } }
      return { current: { ...s.current, status: 'done', result } }
    })
  },
}))
