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

// ── Agent / Activity types ─────────────────────────────────────────────────

export interface AgentContentText { type: 'text'; text: string }
export interface AgentContentThinking { type: 'thinking'; thinking: string }
export interface AgentContentToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export type AgentContentBlock = AgentContentText | AgentContentThinking | AgentContentToolUse

export interface AgentToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | AgentContentBlock[]
  is_error?: boolean
}

export interface AgentSystemEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  model?: string
}

export interface AgentAssistantEvent {
  type: 'assistant'
  message: { id?: string; content: AgentContentBlock[] }
}

export interface AgentUserEvent {
  type: 'user'
  message: { content: AgentToolResultBlock[] }
}

export interface AgentResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  result?: string
  session_id?: string
  total_cost_usd?: number
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
  duration_ms?: number
  error?: string
}

export interface AgentErrorEvent {
  type: 'error'
  message: string
}

// source is injected by the Interface layer — not in the claude CLI wire format.
// 'chat' = triggered by user in the chat panel
// 'daemon' = triggered by the autonomous background engine
export type AgentEventSource = 'chat' | 'daemon' | 'spec-generator'

export type AgentEvent = (
  | AgentSystemEvent
  | AgentAssistantEvent
  | AgentUserEvent
  | AgentResultEvent
  | AgentErrorEvent
) & { source?: AgentEventSource }

// ── Activity card data types ───────────────────────────────────────────────

export type CardType =
  | 'thinking' | 'read' | 'edit' | 'write' | 'bash'
  | 'search' | 'webfetch' | 'task' | 'permission' | 'error' | 'summary'
  | 'browsercheck'

interface BaseCard { id: string; ts: number; source?: AgentEventSource }

export interface ThinkingCard extends BaseCard { cardType: 'thinking'; text: string }
export interface ReadCard extends BaseCard {
  cardType: 'read'; toolUseId: string; filePath: string
  startLine?: number; endLine?: number; resultContent?: string; isError?: boolean
}
export interface EditCard extends BaseCard {
  cardType: 'edit'; toolUseId: string; filePath: string
  oldContent?: string; newContent?: string; result?: string; isError?: boolean
}
export interface WriteCard extends BaseCard {
  cardType: 'write'; toolUseId: string; filePath: string
  content?: string; result?: string; isError?: boolean
}
export interface BashCard extends BaseCard {
  cardType: 'bash'; toolUseId: string; command: string
  output?: string; isError?: boolean
}
export interface SearchCard extends BaseCard {
  cardType: 'search'; toolUseId: string; toolName: string; pattern: string
  resultContent?: string; isError?: boolean
}
export interface WebFetchCard extends BaseCard {
  cardType: 'webfetch'; toolUseId: string; url: string
  resultContent?: string; isError?: boolean
}
export interface TaskCard extends BaseCard {
  cardType: 'task'; toolUseId: string; description: string
  result?: string; isError?: boolean
}
export interface PermissionCard extends BaseCard {
  cardType: 'permission'; requestId: string; toolName: string
  input: Record<string, unknown>; decision?: 'allow' | 'deny'
}
export interface ErrorCard extends BaseCard { cardType: 'error'; message: string }
export interface SummaryCard extends BaseCard { cardType: 'summary'; text: string }

export interface BrowserCheckResultData {
  url: string
  finalUrl: string
  status: number
  title: string
  rootChildren: number
  bodyBackground: string
  domSnippet: string
  consoleMessages: Array<{ level: string; text: string; url?: string; line?: number }>
  networkRequests: Array<{ url: string; status?: number; contentType?: string; ok: boolean }>
  failedRequests: Array<{ url: string; errorText: string }>
  cspViolations: Array<{ violatedDirective: string; blockedURI: string }>
  screenshotPath: string
  durationMs: number
}

export interface BrowserCheckCard extends BaseCard {
  cardType: 'browsercheck'
  toolUseId: string
  url: string
  result?: BrowserCheckResultData
  isError?: boolean
}

export type ActivityCardData =
  | ThinkingCard | ReadCard | EditCard | WriteCard | BashCard
  | SearchCard | WebFetchCard | TaskCard | PermissionCard | ErrorCard | SummaryCard
  | BrowserCheckCard

export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  children?: TreeNode[]
  size?: number
  mtime?: number
}

export interface FileViewerData {
  content: string
  sizeBytes: number
  mtime: number
  isBinary: boolean
  truncated?: boolean
}

export interface FileChangedEvent {
  projectId: string
  relativePath: string
  kind: 'add' | 'change' | 'unlink'
}

export interface AppSettings {
  theme: 'dark' | 'light'
  defaultModel: ModelName
  defaultProjectsFolder: string
  mcpServers: Array<{ name: string; command: string; args: string[] }>
}

export interface ElectronAPI {
  ping: () => Promise<PongPayload>
  layoutGetSizes: () => Promise<LayoutSizes | null>
  layoutSetSizes: (sizes: LayoutSizes) => Promise<void>
  projectList: () => Promise<Project[]>
  projectOpenDialog: () => Promise<Project | null>
  projectActivate: (id: string) => Promise<ProjectActivateResult>
  projectRemove: (id: string) => Promise<void>
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
  chatSend: (projectPath: string, sessionId: string, message: ChatMessage, model: string, projectId: string) => Promise<void>
  chatOnMessageAppended: (callback: (sessionId: string, message: ChatMessage) => void) => () => void
  modelGet: () => Promise<string>
  modelSet: (model: ModelName) => Promise<void>
  fsListProjectFiles: (projectPath: string) => Promise<string[]>
  fsSaveAttachment: (projectPath: string, fileName: string, data: Uint8Array) => Promise<string>
  fsShowOpenDialog: () => Promise<string[]>
  fsGetTree: (projectPath: string) => Promise<TreeNode[]>
  fsReadFile: (projectPath: string, relativePath: string) => Promise<FileViewerData>
  fsWriteFile: (projectPath: string, relativePath: string, content: string) => Promise<{ mtime: number }>
  fsOnFileChanged: (callback: (event: FileChangedEvent) => void) => () => void
  systemTakeScreenshot: (projectPath: string) => Promise<string | null>

  // ── Agent ─────────────────────────────────────────────────────────────────
  agentAbort: (sessionId: string) => Promise<void>
  agentPermissionResponse: (requestId: string, decision: 'allow' | 'deny') => Promise<void>
  agentOnEvent: (callback: (event: AgentEvent) => void) => () => void

  // ── App / Settings / Onboarding ──────────────────────────────────────────
  appVersion: () => Promise<string>
  appOpenFolderDialog: () => Promise<string | null>
  settingsGet: () => Promise<AppSettings>
  settingsSet: (settings: Partial<AppSettings>) => Promise<void>
  onboardingIsDone: () => Promise<boolean>
  onboardingComplete: () => Promise<void>

  // ── Secrets ───────────────────────────────────────────────────────────────
  secretsList: (projectId: string) => Promise<string[]>
  secretsReveal: (projectId: string, name: string) => Promise<string | null>
  secretsSet: (projectId: string, name: string, value: string) => Promise<void>
  secretsDelete: (projectId: string, name: string) => Promise<void>
  secretsImportEnv: (projectId: string, envContent: string) => Promise<string[]>
  secretsExportEnv: (projectId: string) => Promise<string>

  // ── Daemon ────────────────────────────────────────────────────────────────
  daemonStatus: () => Promise<DaemonStatus>
  daemonRunNow: (projectId: string, options?: { dryRun?: boolean }) => Promise<CycleResult>
  daemonStart: () => Promise<void>
  daemonStop: () => Promise<void>
  daemonGetProjectConfig: (projectId: string) => Promise<DaemonProjectConfig>
  daemonSetProjectConfig: (projectId: string, config: Partial<DaemonProjectConfig>) => Promise<void>
  daemonListQueue: (projectId: string) => Promise<QueueItem[]>
  daemonQueueApprove: (projectId: string, cycleId: string) => Promise<{ success: boolean; conflicts?: string }>
  daemonQueueReject: (projectId: string, cycleId: string) => Promise<void>
  daemonListOpenQuestions: (projectId: string) => Promise<OpenQuestion[]>
  daemonAnswerOpenQuestion: (projectId: string, cycleId: string, answer: string) => Promise<void>
  daemonSetRunAfterQuit: (value: boolean) => Promise<void>
  daemonReadQueueDiff: (projectId: string, cycleId: string) => Promise<string>
  daemonReadJournal: (projectId: string) => Promise<JournalEntry[]>

  // ── GitHub ────────────────────────────────────────────────────────────────
  githubGetAuthStatus: () => Promise<GitHubAuthStatus>
  githubStartOAuth: () => Promise<{ success: boolean; user?: GitHubUser; error?: string }>
  githubDisconnect: () => Promise<void>
  githubOnUserCode: (callback: (payload: { code: string; verificationUri: string }) => void) => () => void
  githubListRepos: (opts: { search?: string; page: number; perPage?: number }) => Promise<GitHubRepoListResult>
  githubCloneRepo: (opts: { cloneUrl: string; fullName: string }) => Promise<{ projectId?: string; error?: string }>

  // ── Git status / commit ───────────────────────────────────────────────────
  gitGetStatus: (projectPath: string) => Promise<GitStatusResult>
  gitGetDiff: (projectPath: string) => Promise<GitDiffResult>
  gitCommitAndPush: (opts: {
    projectPath: string
    files: string[]
    message: string
    body?: string
    pushAfter: boolean
  }) => Promise<{ commitSha?: string; pushed: boolean; error?: string }>

  // ── Spec Architect ────────────────────────────────────────────────────────
  specGenerate: (projectId: string, opts: {
    depth: ResearchDepth
    milestoneIds?: string[]
    overwriteExisting: boolean
  }) => Promise<{ generatedCount: number; skippedCount: number; errors: Array<{ milestoneId: string; error: string }> }>
  specOnProgress: (callback: (event: SpecProgressEvent) => void) => () => void
  specOnAutoSuggest: (callback: (projectId: string) => void) => () => void
  specList: (projectPath: string) => Promise<string[]>
  specListMilestones: (projectPath: string) => Promise<MilestoneRef[]>
}

export type ResearchDepth = 'light' | 'standard' | 'deep'

export interface MilestoneRef {
  id: string
  text: string
  phase: string
  checked: boolean
  specPath: string | null
  specSlug: string
}

export interface SpecProgressEvent {
  type: 'start' | 'milestone-start' | 'milestone-event' | 'milestone-done' | 'milestone-skipped' | 'complete' | 'error'
  milestoneId?: string
  milestoneText?: string
  agentEvent?: AgentEvent
  error?: string
  generatedCount?: number
  skippedCount?: number
}

export interface JournalEntry {
  id: string
  ts: string
  project: string
  event: string
  cycleId: string
  data: Record<string, unknown>
}

// ── GitHub types ───────────────────────────────────────────────────────────

export interface GitHubUser {
  login: string
  avatarUrl: string
}

export interface GitHubAuthStatus {
  connected: boolean
  user?: GitHubUser
}

export interface GitHubRepo {
  id: number
  name: string
  fullName: string
  description: string | null
  defaultBranch: string
  private: boolean
  updatedAt: string
  cloneUrl: string
}

export interface GitHubRepoListResult {
  repos: GitHubRepo[]
  hasMore: boolean
  totalCount: number
}

export interface GitStatusResult {
  changedFiles: number
  ahead: number
  behind: number
  branch: string | null
}

export interface GitDiffFile {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '?'
  additions: number
  deletions: number
}

export interface GitDiffResult {
  files: GitDiffFile[]
  fullDiff: string
}

// ── Daemon types ───────────────────────────────────────────────────────────

export interface DaemonStatus {
  running: boolean
  activeCycle: {
    projectId: string
    startedAt: number
    cycleId: string
    phase: 'planning' | 'building' | 'verifying' | 'reflecting' | 'committing'
  } | null
  queueLength: number
  lastCycleAt: number | null
  lastCycleOutcome: string | null
  enabledProjectIds: string[]
}

export interface DaemonProjectConfig {
  enabled: boolean
  schedule: 'manual' | 'hourly' | 'nightly' | 'continuous'
  weight: number
  lastCycleAt: number | null
  lastCycleOutcome: string | null
}

export interface CycleResult {
  cycleId: string
  projectId: string
  outcome: 'committed' | 'queued' | 'blocked' | 'failed' | 'phase-complete' | 'dry-run'
  constraint?: string
  durationMs: number
  error?: string
}

export interface QueueItem {
  cycleId: string
  constraint: string
  reason: string
  type: 'verify-failed' | 'blocked' | 'queue-for-approval'
  question?: string
  ts: string
}

export interface OpenQuestion {
  cycleId: string
  question: string
  constraint: string
  ts: string
}
