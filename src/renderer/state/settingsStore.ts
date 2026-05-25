import { create } from 'zustand'
import type { AppSettings } from '../../shared/types'

interface SettingsState {
  settings: AppSettings | null
  load: () => Promise<void>
  patch: (patch: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,

  load: async () => {
    const settings = await window.api.settingsGet()
    set({ settings })
  },

  patch: (patch) => {
    const current = get().settings
    if (!current) return
    set({ settings: { ...current, ...patch } })
  },
}))
