import { create } from 'zustand'
import type { GoalsMd, Project } from '../../shared/types'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  activeProjectBranch: string | null
  activeProjectGoals: GoalsMd | null
  goalsExpanded: boolean
  loading: boolean
  pendingProjectSwitch: { toProjectId: string } | null

  loadProjects: (overrideProjectId?: string) => Promise<void>
  openProjectDialog: () => Promise<void>
  activateProject: (id: string) => Promise<void>
  requestProjectSwitch: (id: string) => Promise<void>
  confirmProjectSwitch: (action: 'save-all' | 'discard-all') => Promise<void>
  cancelProjectSwitch: () => void
  setGoalsExpanded: (v: boolean) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProjectBranch: null,
  activeProjectGoals: null,
  goalsExpanded: false,
  loading: false,
  pendingProjectSwitch: null,

  loadProjects: async (overrideProjectId?: string) => {
    const projects = await window.api.projectList()
    set({ projects })

    if (projects.length === 0) return

    // If a specific project was requested (e.g. new window opened for that project),
    // activate it; otherwise activate the most recently opened one.
    const idToActivate = overrideProjectId
      ?? [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0].id

    const result = await window.api.projectActivate(idToActivate)
    if (result) {
      set({
        activeProjectId: result.project.id,
        activeProjectBranch: result.branch,
        activeProjectGoals: result.goals,
      })
    }
  },

  openProjectDialog: async () => {
    set({ loading: true })
    try {
      const project = await window.api.projectOpenDialog()
      if (!project) return
      const result = await window.api.projectActivate(project.id)
      set((state) => ({
        projects: [
          ...state.projects.filter((p) => p.id !== project.id),
          result.project,
        ],
        activeProjectId: result.project.id,
        activeProjectBranch: result.branch,
        activeProjectGoals: result.goals,
      }))
    } finally {
      set({ loading: false })
    }
  },

  activateProject: async (id: string) => {
    set({ loading: true })
    try {
      const result = await window.api.projectActivate(id)
      if (!result) return
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === result.project.id ? result.project : p
        ),
        activeProjectId: result.project.id,
        activeProjectBranch: result.branch,
        activeProjectGoals: result.goals,
      }))
    } finally {
      set({ loading: false })
    }
  },

  requestProjectSwitch: async (id: string) => {
    const { activeProjectId, projects } = get()
    if (id === activeProjectId) return
    // Lazy import to avoid circular dep at module-load time
    const { useEditorStore } = await import('./editorStore')
    const editorFiles = useEditorStore.getState().openFilesByProject[activeProjectId ?? ''] ?? []
    const hasDirty = editorFiles.some((f) => f.editedContent !== f.originalContent)
    if (hasDirty) {
      set({ pendingProjectSwitch: { toProjectId: id } })
      return
    }
    if (activeProjectId) useEditorStore.getState().clearProject(activeProjectId)
    await get().activateProject(id)
  },

  confirmProjectSwitch: async (action) => {
    const { pendingProjectSwitch, activeProjectId, projects } = get()
    if (!pendingProjectSwitch) return
    const { useEditorStore } = await import('./editorStore')
    if (action === 'save-all' && activeProjectId) {
      const editorStore = useEditorStore.getState()
      const files = editorStore.openFilesByProject[activeProjectId] ?? []
      const project = projects.find((p) => p.id === activeProjectId)
      if (project) {
        for (const file of files) {
          if (file.editedContent !== file.originalContent) {
            await editorStore.saveFile(project.path, activeProjectId, file.relativePath)
          }
        }
      }
    }
    if (activeProjectId) useEditorStore.getState().clearProject(activeProjectId)
    set({ pendingProjectSwitch: null })
    await get().activateProject(pendingProjectSwitch.toProjectId)
  },

  cancelProjectSwitch: () => set({ pendingProjectSwitch: null }),

  setGoalsExpanded: (v: boolean) => set({ goalsExpanded: v }),
}))
