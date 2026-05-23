import { create } from 'zustand'

interface SpecStore {
  open: boolean
  initialMode: 'mode-select' | 'refine-config'
  preselectedMilestoneId?: string
  openModal: (opts?: { initialMode?: 'mode-select' | 'refine-config'; preselectedMilestoneId?: string }) => void
  closeModal: () => void
}

export const useSpecStore = create<SpecStore>((set) => ({
  open: false,
  initialMode: 'mode-select',
  preselectedMilestoneId: undefined,
  openModal: (opts) => set({
    open: true,
    initialMode: opts?.initialMode ?? 'mode-select',
    preselectedMilestoneId: opts?.preselectedMilestoneId,
  }),
  closeModal: () => set({ open: false, preselectedMilestoneId: undefined }),
}))
