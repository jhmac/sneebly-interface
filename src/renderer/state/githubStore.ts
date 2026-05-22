import { create } from 'zustand'
import type { GitHubUser } from '../../shared/types'

interface GitHubState {
  checked: boolean
  connected: boolean
  user: GitHubUser | null

  checkStatus: () => Promise<void>
  setConnected: (user: GitHubUser) => void
  setDisconnected: () => void
}

export const useGitHubStore = create<GitHubState>((set) => ({
  checked: false,
  connected: false,
  user: null,

  checkStatus: async () => {
    try {
      const status = await window.api.githubGetAuthStatus()
      set({ checked: true, connected: status.connected, user: status.user ?? null })
    } catch {
      set({ checked: true, connected: false, user: null })
    }
  },

  setConnected: (user) => set({ connected: true, user }),
  setDisconnected: () => set({ connected: false, user: null }),
}))
