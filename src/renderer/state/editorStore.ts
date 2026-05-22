import { create } from 'zustand'

function extToLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown',
    html: 'html', css: 'css', scss: 'css',
    py: 'python', go: 'go', rs: 'rust',
    sh: 'shell', bash: 'shell',
    yaml: 'yaml', yml: 'yaml',
    sql: 'sql',
  }
  return map[ext] ?? 'plaintext'
}

export interface OpenFile {
  projectId: string
  relativePath: string
  absolutePath: string
  originalContent: string
  editedContent: string
  mtime: number
  language: string
  isBinary: boolean
  externalChange: boolean
}

interface EditorState {
  openFilesByProject: Record<string, OpenFile[]>
  activeFilePath: string | null
  recentSelfWrites: Set<string>
  modalOpen: boolean

  openModal: () => void
  closeModal: () => void
  setActiveFilePath: (path: string | null) => void
  openFile: (projectPath: string, projectId: string, relativePath: string) => Promise<void>
  closeFile: (projectId: string, relativePath: string) => void
  setContent: (projectId: string, relativePath: string, content: string) => void
  saveFile: (projectPath: string, projectId: string, relativePath: string) => Promise<void>
  handleExternalChange: (projectId: string, relativePath: string) => void
  reloadFile: (projectPath: string, projectId: string, relativePath: string) => Promise<void>
  clearProject: (projectId: string) => void
  clearExternalChange: (projectId: string, relativePath: string) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFilesByProject: {},
  activeFilePath: null,
  recentSelfWrites: new Set(),
  modalOpen: false,

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  setActiveFilePath: (path: string | null) => set({ activeFilePath: path }),

  openFile: async (projectPath: string, projectId: string, relativePath: string) => {
    const existing = get().openFilesByProject[projectId] ?? []
    if (existing.find((f) => f.relativePath === relativePath)) {
      set({ activeFilePath: relativePath })
      return
    }
    try {
      const data = await window.api.fsReadFile(projectPath, relativePath)
      const absolutePath = projectPath.replace(/\/$/, '') + '/' + relativePath
      const newFile: OpenFile = {
        projectId,
        relativePath,
        absolutePath,
        originalContent: data.content,
        editedContent: data.content,
        mtime: data.mtime,
        language: extToLanguage(relativePath),
        isBinary: data.isBinary,
        externalChange: false,
      }
      set((s) => {
        const current = s.openFilesByProject[projectId] ?? []
        // Dedupe: another call may have added this file while we were awaiting
        if (current.find((f) => f.relativePath === relativePath)) {
          return { activeFilePath: relativePath }
        }
        return {
          openFilesByProject: { ...s.openFilesByProject, [projectId]: [...current, newFile] },
          activeFilePath: relativePath,
        }
      })
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  },

  closeFile: (projectId: string, relativePath: string) => {
    const files = get().openFilesByProject[projectId] ?? []
    const next = files.filter((f) => f.relativePath !== relativePath)
    let { activeFilePath } = get()
    if (activeFilePath === relativePath) {
      const idx = files.findIndex((f) => f.relativePath === relativePath)
      activeFilePath = next[Math.min(idx, next.length - 1)]?.relativePath ?? null
    }
    set((s) => ({
      openFilesByProject: { ...s.openFilesByProject, [projectId]: next },
      activeFilePath,
    }))
  },

  setContent: (projectId: string, relativePath: string, content: string) => {
    const files = get().openFilesByProject[projectId] ?? []
    set((s) => ({
      openFilesByProject: {
        ...s.openFilesByProject,
        [projectId]: files.map((f) =>
          f.relativePath === relativePath ? { ...f, editedContent: content } : f
        ),
      },
    }))
  },

  saveFile: async (projectPath: string, projectId: string, relativePath: string) => {
    const files = get().openFilesByProject[projectId] ?? []
    const file = files.find((f) => f.relativePath === relativePath)
    if (!file || file.isBinary) return

    try {
      const result = await window.api.fsWriteFile(projectPath, relativePath, file.editedContent)
      // Mark self-write after the write completes so chokidar's event arrives within the window
      const next = new Set(get().recentSelfWrites)
      next.add(relativePath)
      set({ recentSelfWrites: next })
      setTimeout(() => {
        const cur = new Set(get().recentSelfWrites)
        cur.delete(relativePath)
        set({ recentSelfWrites: cur })
      }, 500)
      set((s) => ({
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: (s.openFilesByProject[projectId] ?? []).map((f) =>
            f.relativePath === relativePath
              ? { ...f, originalContent: file.editedContent, mtime: result.mtime, externalChange: false }
              : f
          ),
        },
      }))
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  },

  handleExternalChange: (projectId: string, relativePath: string) => {
    if (get().recentSelfWrites.has(relativePath)) return
    const files = get().openFilesByProject[projectId] ?? []
    if (!files.find((f) => f.relativePath === relativePath)) return
    set((s) => ({
      openFilesByProject: {
        ...s.openFilesByProject,
        [projectId]: (s.openFilesByProject[projectId] ?? []).map((f) =>
          f.relativePath === relativePath ? { ...f, externalChange: true } : f
        ),
      },
    }))
  },

  reloadFile: async (projectPath: string, projectId: string, relativePath: string) => {
    try {
      const data = await window.api.fsReadFile(projectPath, relativePath)
      set((s) => ({
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: (s.openFilesByProject[projectId] ?? []).map((f) =>
            f.relativePath === relativePath
              ? { ...f, originalContent: data.content, editedContent: data.content, mtime: data.mtime, externalChange: false }
              : f
          ),
        },
      }))
    } catch (err) {
      console.error('Failed to reload file:', err)
    }
  },

  clearProject: (projectId: string) => {
    const next = { ...get().openFilesByProject }
    delete next[projectId]
    set({ openFilesByProject: next, activeFilePath: null })
  },

  clearExternalChange: (projectId: string, relativePath: string) => {
    set((s) => ({
      openFilesByProject: {
        ...s.openFilesByProject,
        [projectId]: (s.openFilesByProject[projectId] ?? []).map((f) =>
          f.relativePath === relativePath ? { ...f, externalChange: false } : f
        ),
      },
    }))
  },
}))
