import { create } from 'zustand'
import type { PendingLearning, PromotedLearning } from '../../shared/types'

interface LearningsState {
  pending: PendingLearning[]
  promoted: PromotedLearning[]
  badgeCount: number
  loading: boolean
  shadowRunningId: string | null

  load: (projectId: string) => Promise<void>
  promote: (projectId: string, learningId: string) => Promise<void>
  reject: (projectId: string, learningId: string) => Promise<void>
  revert: (projectId: string, learningId: string) => Promise<void>
  runShadow: (projectId: string, learningId: string) => Promise<void>
  refreshBadge: (projectId: string) => Promise<void>
  reset: () => void
}

export const useLearningsStore = create<LearningsState>((set, get) => ({
  pending: [],
  promoted: [],
  badgeCount: 0,
  loading: false,
  shadowRunningId: null,

  load: async (projectId: string) => {
    set({ loading: true })
    try {
      const [pending, promoted] = await Promise.all([
        window.api.learningsListPending(projectId),
        window.api.learningsListPromoted(projectId),
      ])
      set({ pending, promoted, badgeCount: pending.length, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  promote: async (projectId: string, learningId: string) => {
    await window.api.learningsPromote(projectId, learningId).catch(() => {})
    await get().load(projectId)
  },

  reject: async (projectId: string, learningId: string) => {
    await window.api.learningsReject(projectId, learningId).catch(() => {})
    await get().load(projectId)
  },

  revert: async (projectId: string, learningId: string) => {
    await window.api.learningsRevert(projectId, learningId).catch(() => {})
    await get().load(projectId)
  },

  runShadow: async (projectId: string, learningId: string) => {
    if (get().shadowRunningId) return
    set({ shadowRunningId: learningId })
    try {
      const updated = await window.api.learningsRunShadow(projectId, learningId).catch(() => null)
      if (updated) {
        set((s) => ({
          pending: s.pending.map((e) => (e.id === learningId ? updated : e)),
        }))
      }
    } finally {
      set({ shadowRunningId: null })
    }
  },

  refreshBadge: async (projectId: string) => {
    try {
      const badgeCount = await window.api.learningsBadgeCount(projectId)
      set({ badgeCount })
    } catch {}
  },

  reset: () => set({ pending: [], promoted: [], badgeCount: 0, loading: false, shadowRunningId: null }),
}))
