import { create } from 'zustand'

const REVEAL_DURATION_MS = 10_000

interface RevealEntry {
  value: string
  expiresAt: number
  timerId: ReturnType<typeof setTimeout>
}

interface SecretsState {
  panelOpen: boolean
  secretNames: string[]
  revealed: Map<string, RevealEntry>

  openPanel: () => void
  closePanel: () => void
  loadNames: (projectId: string) => Promise<void>
  reveal: (projectId: string, name: string) => Promise<void>
  maskNow: (name: string) => void
  setSecret: (projectId: string, name: string, value: string) => Promise<void>
  deleteSecret: (projectId: string, name: string) => Promise<void>
  importEnv: (projectId: string, envContent: string) => Promise<string[]>
  exportEnv: (projectId: string) => Promise<string>
  reset: () => void
}

export const useSecretsStore = create<SecretsState>((set, get) => ({
  panelOpen: false,
  secretNames: [],
  revealed: new Map(),

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),

  loadNames: async (projectId: string) => {
    const names = await window.api.secretsList(projectId)
    set({ secretNames: names })
  },

  reveal: async (projectId: string, name: string) => {
    const existing = get().revealed.get(name)
    if (existing) {
      clearTimeout(existing.timerId)
      get().revealed.delete(name)
    }
    const value = await window.api.secretsReveal(projectId, name)
    if (value === null) return
    const timerId = setTimeout(() => {
      const { revealed } = get()
      const next = new Map(revealed)
      next.delete(name)
      set({ revealed: next })
    }, REVEAL_DURATION_MS)
    const next = new Map(get().revealed)
    next.set(name, { value, expiresAt: Date.now() + REVEAL_DURATION_MS, timerId })
    set({ revealed: next })
  },

  maskNow: (name: string) => {
    const entry = get().revealed.get(name)
    if (entry) clearTimeout(entry.timerId)
    const next = new Map(get().revealed)
    next.delete(name)
    set({ revealed: next })
  },

  setSecret: async (projectId: string, name: string, value: string) => {
    await window.api.secretsSet(projectId, name, value)
    await get().loadNames(projectId)
    // If it was revealed, clear that too
    get().maskNow(name)
  },

  deleteSecret: async (projectId: string, name: string) => {
    await window.api.secretsDelete(projectId, name)
    get().maskNow(name)
    set((s) => ({ secretNames: s.secretNames.filter((n) => n !== name) }))
  },

  importEnv: async (projectId: string, envContent: string) => {
    const imported = await window.api.secretsImportEnv(projectId, envContent)
    await get().loadNames(projectId)
    return imported
  },

  exportEnv: async (projectId: string) => {
    return window.api.secretsExportEnv(projectId)
  },

  reset: () => {
    // Clear all reveal timers
    for (const entry of get().revealed.values()) clearTimeout(entry.timerId)
    set({ secretNames: [], revealed: new Map() })
  },
}))
