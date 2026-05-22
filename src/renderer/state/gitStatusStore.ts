import { create } from 'zustand'
import type { GitStatusResult } from '../../shared/types'
import { useProjectStore } from './projectStore'

interface GitStatusState {
  status: GitStatusResult | null
  loading: boolean
  commitModalOpen: boolean

  refresh: () => Promise<void>
  openCommitModal: () => void
  closeCommitModal: () => void
  reset: () => void
}

export const useGitStatusStore = create<GitStatusState>((set) => ({
  status: null,
  loading: false,
  commitModalOpen: false,

  refresh: async () => {
    const { activeProjectId, projects } = useProjectStore.getState()
    if (!activeProjectId) return
    const project = projects.find((p) => p.id === activeProjectId)
    if (!project) return

    set({ loading: true })
    try {
      const status = await window.api.gitGetStatus(project.path)
      set({ status, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  openCommitModal: () => set({ commitModalOpen: true }),
  closeCommitModal: () => set({ commitModalOpen: false }),
  reset: () => set({ status: null, loading: false }),
}))
