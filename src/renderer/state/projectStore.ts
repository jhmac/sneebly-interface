import { create } from 'zustand'
import type { GoalsMd, Project } from '../../shared/types'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  activeProjectBranch: string | null
  activeProjectGoals: GoalsMd | null
  goalsExpanded: boolean
  loading: boolean

  loadProjects: () => Promise<void>
  openProjectDialog: () => Promise<void>
  activateProject: (id: string) => Promise<void>
  setGoalsExpanded: (v: boolean) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  activeProjectBranch: null,
  activeProjectGoals: null,
  goalsExpanded: false,
  loading: false,

  loadProjects: async () => {
    const projects = await window.api.projectList()
    set({ projects })

    // Auto-activate the most recently opened project
    if (projects.length > 0) {
      const sorted = [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      const result = await window.api.projectActivate(sorted[0].id)
      if (result) {
        set({
          activeProjectId: result.project.id,
          activeProjectBranch: result.branch,
          activeProjectGoals: result.goals,
        })
      }
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

  setGoalsExpanded: (v: boolean) => set({ goalsExpanded: v }),
}))
