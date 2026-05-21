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

export type PreviewStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'crashed'
  | 'stopped'
  | 'no-script'

export type DeviceSize = 'desktop' | 'tablet' | 'iphone'

export interface PreviewStatusEvent {
  projectId: string
  type: PreviewStatus
  url?: string
  stderrTail?: string[]
}

export interface ElectronAPI {
  ping: () => Promise<PongPayload>
  layoutGetSizes: () => Promise<LayoutSizes | null>
  layoutSetSizes: (sizes: LayoutSizes) => Promise<void>
  projectList: () => Promise<Project[]>
  projectOpenDialog: () => Promise<Project | null>
  projectActivate: (id: string) => Promise<ProjectActivateResult>
  previewStart: (projectId: string, projectPath: string) => Promise<void>
  previewStop: (projectId: string) => Promise<void>
  previewRestart: (projectId: string, projectPath: string) => Promise<void>
  previewGetLogs: (projectId: string) => Promise<string[]>
  previewOnStatus: (callback: (event: PreviewStatusEvent) => void) => () => void
  shellOpenExternal: (url: string) => Promise<void>
}
