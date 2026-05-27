import { create } from 'zustand'

// ─── Store ────────────────────────────────────────────────────────────────────

interface DeciderStore {
  /** Count of medium + high risk decisions across all pre-flight sidecar files. */
  flaggedCount: number

  /** Fetch the current flagged count from main and update the store. */
  refreshFlaggedCount: (projectId: string) => Promise<void>
}

export const useDeciderStore = create<DeciderStore>((set) => ({
  flaggedCount: 0,

  refreshFlaggedCount: async (projectId: string) => {
    try {
      const count = await window.api.deciderGetFlaggedCount(projectId)
      set({ flaggedCount: count })
    } catch (err) {
      console.warn('[deciderStore] failed to refresh flagged count:', err)
    }
  },
}))
