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

export type ModelName = 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5'

export interface ChatAttachment {
  kind: 'image' | 'file' | 'screenshot'
  path: string
  name: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  attachments?: ChatAttachment[]
  ts: number
  checkpoint?: true
}

export interface SessionSummary {
  id: string
  createdAt: number
  lastMessageAt: number
  messageCount: number
  preview: string
}

export interface PendingAttachment {
  id: string
  kind: 'image' | 'file' | 'screenshot'
  path: string
  name: string
  thumbnailUrl?: string
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
  sessionList: (projectPath: string) => Promise<SessionSummary[]>
  sessionLoad: (projectPath: string, sessionId: string) => Promise<ChatMessage[]>
  sessionCreate: (projectPath: string) => Promise<string>
  sessionClear: (projectPath: string, sessionId: string) => Promise<void>
  sessionGetActive: (projectId: string) => Promise<string | null>
  sessionSetActive: (projectId: string, sessionId: string | null) => Promise<void>
  chatSend: (projectPath: string, sessionId: string, message: ChatMessage) => Promise<void>
  chatOnMessageAppended: (callback: (sessionId: string, message: ChatMessage) => void) => () => void
  modelGet: () => Promise<string>
  modelSet: (model: ModelName) => Promise<void>
  fsListProjectFiles: (projectPath: string) => Promise<string[]>
  fsSaveAttachment: (projectPath: string, fileName: string, data: Uint8Array) => Promise<string>
  fsShowOpenDialog: () => Promise<string[]>
  systemTakeScreenshot: (projectPath: string) => Promise<string | null>
}
