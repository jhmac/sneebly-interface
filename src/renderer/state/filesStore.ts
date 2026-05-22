import { create } from 'zustand'
import type { TreeNode, FileViewerData } from '../../shared/types'

interface FilesState {
  tree: TreeNode[] | null
  expandedPaths: Set<string>
  searchQuery: string
  panelOpen: boolean
  viewerOpen: boolean
  viewerFile: { path: string; absolutePath: string; data: FileViewerData } | null
  loading: boolean
  currentProjectId: string | null

  openPanel: () => void
  closePanel: () => void
  toggleExpand: (path: string) => void
  setSearchQuery: (q: string) => void
  loadTree: (projectPath: string, projectId: string) => Promise<void>
  openFile: (projectPath: string, relativePath: string) => Promise<void>
  closeViewer: () => void
  resetForProject: () => void
}

export const useFilesStore = create<FilesState>((set, get) => ({
  tree: null,
  expandedPaths: new Set(),
  searchQuery: '',
  panelOpen: false,
  viewerOpen: false,
  viewerFile: null,
  loading: false,
  currentProjectId: null,

  openPanel: () => set({ panelOpen: true }),

  closePanel: () => set({ panelOpen: false, searchQuery: '' }),

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

  openFile: async (projectPath: string, relativePath: string) => {
    try {
      const data = await window.api.fsReadFile(projectPath, relativePath)
      const absolutePath = projectPath.replace(/\/$/, '') + '/' + relativePath
      set({ viewerFile: { path: relativePath, absolutePath, data }, viewerOpen: true })
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  },

  closeViewer: () => set({ viewerOpen: false }),

  resetForProject: () =>
    set({
      tree: null,
      viewerFile: null,
      viewerOpen: false,
      expandedPaths: new Set(),
      searchQuery: '',
      currentProjectId: null,
    }),
}))
