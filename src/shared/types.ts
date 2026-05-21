export interface PongPayload {
  message: string
  timestamp: number
}

export interface LayoutSizes {
  vertical: Record<string, number>
  horizontal: Record<string, number>
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: number
  lastOpenedAt: number
}

export interface GoalsMilestone {
  text: string
  checked: boolean
}

export interface GoalsPhase {
  number: number
  name: string
  behaviors: string[]
  milestones: GoalsMilestone[]
}

export interface GoalsMd {
  mission: string
  techStack: Record<string, string>
  phases: GoalsPhase[]
  openQuestions: string[]
}

export interface ProjectActivateResult {
  project: Project
  branch: string | null
  goals: GoalsMd | null
}

export interface ElectronAPI {
  ping: () => Promise<PongPayload>
  layoutGetSizes: () => Promise<LayoutSizes | null>
  layoutSetSizes: (sizes: LayoutSizes) => Promise<void>
  projectList: () => Promise<Project[]>
  projectOpenDialog: () => Promise<Project | null>
  projectActivate: (id: string) => Promise<ProjectActivateResult>
}
