import { create } from 'zustand'

export type AppView = 'workspace' | 'design'

interface ViewStore {
  currentView: AppView
  setView: (view: AppView) => void
}

export const useViewStore = create<ViewStore>((set) => ({
  currentView: 'workspace',
  setView: (view) => set({ currentView: view }),
}))
