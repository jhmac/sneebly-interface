import { create } from 'zustand'
import type { TreeNode } from '../../shared/types'

interface FilesState {
  tree: TreeNode[] | null
  expandedPaths: Set<string>
  searchQuery: string
  loading: boolean
  currentProjectId: string | null

  toggleExpand: (path: string) => void
  setSearchQuery: (q: string) => void
  loadTree: (projectPath: string, projectId: string) => Promise<void>
  resetForProject: () => void
}

export const useFilesStore = create<FilesState>((set, get) => ({
  tree: null,
  expandedPaths: new Set(),
  searchQuery: '',
  loading: false,
  currentProjectId: null,

  toggleExpand: (path: string) => {
    const next = new Set(get().expandedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ expandedPaths: next })
    const { currentProjectId } = get()
    if (currentProjectId) {
      try {
        localStorage.setItem(
          `filesTree.expanded.${currentProjectId}`,
          JSON.stringify([...next])
        )
      } catch { /* ignore */ }
    }
  },

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  loadTree: async (projectPath: string, projectId: string) => {
    if (get().currentProjectId === projectId && get().tree !== null) return
    set({ loading: true, currentProjectId: projectId })
    try {
      let expandedPaths = new Set<string>()
      try {
        const stored = localStorage.getItem(`filesTree.expanded.${projectId}`)
        if (stored) expandedPaths = new Set<string>(JSON.parse(stored) as string[])
      } catch { /* ignore */ }
      const tree = await window.api.fsGetTree(projectPath)
      set({ tree, expandedPaths, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  resetForProject: () =>
    set({
      tree: null,
      expandedPaths: new Set(),
      searchQuery: '',
      currentProjectId: null,
    }),
}))
