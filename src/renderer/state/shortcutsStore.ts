import { create } from 'zustand'
import type { ShortcutsFile } from '../../shared/types'

const EMPTY: ShortcutsFile = { pinned: [], suggested: [], lastRefreshedAt: 0, rejections: [] }

interface ShortcutsState {
  file: ShortcutsFile
  load: (projectId: string) => Promise<void>
  refresh: (projectId: string) => Promise<void>
  pin: (projectId: string, id: string) => Promise<void>
  unpin: (projectId: string, id: string) => Promise<void>
  reset: () => void
}

export const useShortcutsStore = create<ShortcutsState>((set) => ({
  file: EMPTY,

  load: async (projectId: string) => {
    try {
      const file = await window.api.shortcutsList(projectId)
      set({ file })
    } catch {
      set({ file: EMPTY })
    }
  },

  refresh: async (projectId: string) => {
    try {
      const file = await window.api.shortcutsRefresh(projectId)
      set({ file })
    } catch {}
  },

  pin: async (projectId: string, id: string) => {
    try {
      const file = await window.api.shortcutsPin(projectId, id)
      set({ file })
    } catch {}
  },

  unpin: async (projectId: string, id: string) => {
    try {
      const file = await window.api.shortcutsUnpin(projectId, id)
      set({ file })
    } catch {}
  },

  reset: () => set({ file: EMPTY }),
}))
