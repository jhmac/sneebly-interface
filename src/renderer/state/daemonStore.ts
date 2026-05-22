import { create } from 'zustand'
import type { DaemonStatus } from '../../shared/types'

type ModalType = 'queue' | 'questions' | 'settings' | null

interface DaemonState {
  status: DaemonStatus | null
  questionCounts: Record<string, number>
  modalOpen: ModalType

  refreshStatus: () => Promise<void>
  refreshQuestionCounts: () => Promise<void>
  openModal: (modal: ModalType) => void
  closeModal: () => void
}

export const useDaemonStore = create<DaemonState>((set, get) => ({
  status: null,
  questionCounts: {},
  modalOpen: null,

  refreshStatus: async () => {
    try {
      const status = await window.api.daemonStatus()
      set({ status })
    } catch {
      // IPC failure is non-fatal
    }
  },

  refreshQuestionCounts: async () => {
    try {
      const status = get().status
      if (!status) return
      const { useProjectStore } = await import('./projectStore')
      const projects = useProjectStore.getState().projects
      const counts: Record<string, number> = {}
      await Promise.all(
        projects.map(async (p) => {
          try {
            const qs = await window.api.daemonListOpenQuestions(p.id)
            counts[p.id] = qs.length
          } catch {
            counts[p.id] = 0
          }
        })
      )
      set({ questionCounts: counts })
    } catch {
      // Best-effort
    }
  },

  openModal: (modal) => set({ modalOpen: modal }),
  closeModal: () => set({ modalOpen: null }),
}))
