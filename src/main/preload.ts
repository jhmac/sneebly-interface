import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  ElectronAPI,
  LayoutSizes,
  PongPayload,
  Project,
  ProjectActivateResult,
  ProjectUpdateInput,
  ProjectRemixResult,
  PreviewStatusEvent,
  ChatMessage,
  SessionSummary,
  ModelName,
  AgentEvent,
  AppSettings,
  DaemonStatus,
  DaemonProjectConfig,
  CycleResult,
  QueueItem,
  OpenQuestion,
  TreeNode,
  FileViewerData,
  FileChangedEvent,
  JournalEntry,
  GitHubAuthStatus,
  GitHubUser,
  GitHubRepoListResult,
  GitStatusResult,
  GitDiffResult,
  SpecProgressEvent,
  MilestoneRef,
  GrillMessage,
} from '../shared/types'

const api: ElectronAPI = {
  // ── Core ──────────────────────────────────────────────────────────────
  ping: (): Promise<PongPayload> => ipcRenderer.invoke(IPC_CHANNELS.PING),

  layoutGetSizes: (): Promise<LayoutSizes | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_GET_SIZES),
  layoutSetSizes: (sizes: LayoutSizes): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_SET_SIZES, sizes),

  // ── Projects ──────────────────────────────────────────────────────────
  projectList: (): Promise<Project[]> => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),
  projectOpenDialog: (): Promise<Project | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_OPEN_DIALOG),
  projectActivate: (id: string): Promise<ProjectActivateResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_ACTIVATE, id),
  projectRemove: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REMOVE, id),
  projectUpdate: (id: string, input: ProjectUpdateInput): Promise<Project | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_UPDATE, id, input),
  projectRemix: (id: string): Promise<ProjectRemixResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REMIX, id),
  windowOpenProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_PROJECT, projectId),

  // ── Preview ───────────────────────────────────────────────────────────
  previewStart: (projectId: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_START, projectId, projectPath),
  previewStop: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_STOP, projectId),
  previewRestart: (projectId: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_RESTART, projectId, projectPath),
  previewGetLogs: (projectId: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_GET_LOGS, projectId),
  previewOnStatus: (callback: (event: PreviewStatusEvent) => void): (() => void) => {
    const h = (_: IpcRendererEvent, e: PreviewStatusEvent) => callback(e)
    ipcRenderer.on(IPC_CHANNELS.PREVIEW_STATUS, h)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PREVIEW_STATUS, h)
  },

  // ── Shell ─────────────────────────────────────────────────────────────
  shellOpenExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),

  // ── Sessions ──────────────────────────────────────────────────────────
  sessionList: (projectPath: string): Promise<SessionSummary[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST, projectPath),
  sessionLoad: (projectPath: string, sessionId: string): Promise<ChatMessage[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD, projectPath, sessionId),
  sessionCreate: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, projectPath),
  sessionClear: (projectPath: string, sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_CLEAR, projectPath, sessionId),
  sessionGetActive: (projectId: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_ACTIVE, projectId),
  sessionSetActive: (projectId: string, sessionId: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_SET_ACTIVE, projectId, sessionId),

  // ── Chat ──────────────────────────────────────────────────────────────
  chatSend: (projectPath: string, sessionId: string, message: ChatMessage, model: string, projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, projectPath, sessionId, message, model, projectId),
  chatOnMessageAppended: (
    callback: (sessionId: string, message: ChatMessage) => void
  ): (() => void) => {
    const h = (_: IpcRendererEvent, sid: string, msg: ChatMessage) => callback(sid, msg)
    ipcRenderer.on(IPC_CHANNELS.CHAT_MESSAGE_APPENDED, h)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_MESSAGE_APPENDED, h)
  },

  // ── Model ─────────────────────────────────────────────────────────────
  modelGet: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.MODEL_GET),
  modelSet: (model: ModelName): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.MODEL_SET, model),

  // ── FS ────────────────────────────────────────────────────────────────
  fsListProjectFiles: (projectPath: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_LIST_PROJECT_FILES, projectPath),
  fsSaveAttachment: (projectPath: string, fileName: string, data: Uint8Array): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_SAVE_ATTACHMENT, projectPath, fileName, data),
  fsShowOpenDialog: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_SHOW_OPEN_DIALOG),
  fsGetTree: (projectPath: string): Promise<TreeNode[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_GET_TREE, projectPath),
  fsReadFile: (projectPath: string, relativePath: string): Promise<FileViewerData> =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, projectPath, relativePath),
  fsWriteFile: (projectPath: string, relativePath: string, content: string): Promise<{ mtime: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, projectPath, relativePath, content),
  fsOnFileChanged: (callback: (event: FileChangedEvent) => void): (() => void) => {
    const h = (_: IpcRendererEvent, event: FileChangedEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.FS_FILE_CHANGED, h)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FS_FILE_CHANGED, h)
  },

  // ── System ────────────────────────────────────────────────────────────
  systemTakeScreenshot: (projectPath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_TAKE_SCREENSHOT, projectPath),

  // ── Agent ─────────────────────────────────────────────────────────────
  agentAbort: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_ABORT, sessionId),
  agentPermissionResponse: (requestId: string, decision: 'allow' | 'deny'): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_PERMISSION_RESPONSE, requestId, decision),
  agentOnEvent: (callback: (event: AgentEvent) => void): (() => void) => {
    const h = (_: IpcRendererEvent, event: AgentEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, h)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, h)
  },

  // ── App / Settings / Onboarding ──────────────────────────────────────────
  appVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
  appOpenFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_FOLDER_DIALOG),
  settingsGet: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  settingsSet: (settings: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),
  onboardingIsDone: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_IS_DONE),
  onboardingComplete: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.ONBOARDING_COMPLETE),

  // ── Secrets ───────────────────────────────────────────────────────────
  secretsList: (projectId: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SECRETS_LIST, projectId),
  secretsReveal: (projectId: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SECRETS_REVEAL, projectId, name),
  secretsSet: (projectId: string, name: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SECRETS_SET, projectId, name, value),
  secretsDelete: (projectId: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SECRETS_DELETE, projectId, name),
  secretsImportEnv: (projectId: string, envContent: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SECRETS_IMPORT_ENV, projectId, envContent),
  secretsExportEnv: (projectId: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.SECRETS_EXPORT_ENV, projectId),

  // ── Daemon ────────────────────────────────────────────────────────────────
  daemonStatus: (): Promise<DaemonStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_STATUS),
  daemonRunNow: (projectId: string, options?: { dryRun?: boolean }): Promise<CycleResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_RUN_NOW, projectId, options),
  daemonStart: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_START),
  daemonStop: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_STOP),
  daemonGetProjectConfig: (projectId: string): Promise<DaemonProjectConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_GET_PROJECT_CONFIG, projectId),
  daemonSetProjectConfig: (projectId: string, config: Partial<DaemonProjectConfig>): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_SET_PROJECT_CONFIG, projectId, config),
  daemonListQueue: (projectId: string): Promise<QueueItem[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_LIST_QUEUE, projectId),
  daemonQueueApprove: (projectId: string, cycleId: string): Promise<{ success: boolean; conflicts?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_QUEUE_APPROVE, projectId, cycleId),
  daemonQueueReject: (projectId: string, cycleId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_QUEUE_REJECT, projectId, cycleId),
  daemonListOpenQuestions: (projectId: string): Promise<OpenQuestion[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_LIST_OPEN_QUESTIONS, projectId),
  daemonAnswerOpenQuestion: (projectId: string, cycleId: string, answer: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_ANSWER_OPEN_QUESTION, projectId, cycleId, answer),
  daemonSetRunAfterQuit: (value: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_SET_RUN_AFTER_QUIT, value),
  daemonReadQueueDiff: (projectId: string, cycleId: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_READ_QUEUE_DIFF, projectId, cycleId),
  daemonReadJournal: (projectId: string): Promise<JournalEntry[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DAEMON_READ_JOURNAL, projectId),

  // ── GitHub ────────────────────────────────────────────────────────────────
  githubGetAuthStatus: (): Promise<GitHubAuthStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_AUTH_STATUS),
  githubStartOAuth: (): Promise<{ success: boolean; user?: GitHubUser; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_START_OAUTH),
  githubDisconnect: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_DISCONNECT),
  githubOnUserCode: (callback: (payload: { code: string; verificationUri: string }) => void): (() => void) => {
    const h = (_: IpcRendererEvent, payload: { code: string; verificationUri: string }) => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.GITHUB_OAUTH_USER_CODE, h)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.GITHUB_OAUTH_USER_CODE, h)
  },
  githubListRepos: (opts: { search?: string; page: number; perPage?: number }): Promise<GitHubRepoListResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REPOS, opts),
  githubCloneRepo: (opts: { cloneUrl: string; fullName: string }): Promise<{ projectId?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CLONE_REPO, opts),

  // ── Git status / commit ───────────────────────────────────────────────────
  gitGetStatus: (projectPath: string): Promise<GitStatusResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_STATUS, projectPath),
  gitGetDiff: (projectPath: string): Promise<GitDiffResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_DIFF, projectPath),
  gitCommitAndPush: (opts: {
    projectPath: string
    files: string[]
    message: string
    body?: string
    pushAfter: boolean
  }): Promise<{ commitSha?: string; pushed: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT_AND_PUSH, opts),

  // ── Goals Wizard ──────────────────────────────────────────────────────────
  goalsGrillTurn: (messages: GrillMessage[], userMessage: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GOALS_GRILL_TURN, messages, userMessage),

  goalsGenerate: (ideaSeed: string, messages: GrillMessage[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.GOALS_GENERATE, ideaSeed, messages),

  goalsWrite: (projectId: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GOALS_WRITE, projectId, content),

  goalsUpdateStack: (goalsMd: string, stackReport: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GOALS_UPDATE_STACK, goalsMd, stackReport),

  // ── Spec Architect ────────────────────────────────────────────────────────
  specGenerate: (projectId: string, opts: {
    depth: 'light' | 'standard' | 'deep'
    milestoneIds?: string[]
    overwriteExisting: boolean
  }) => ipcRenderer.invoke(IPC_CHANNELS.SPEC_GENERATE, projectId, opts),

  specRefine: (projectId: string, opts: {
    milestoneId: string
    refinementPrompt: string
    mode: 'edit-only' | 'research'
  }) => ipcRenderer.invoke(IPC_CHANNELS.SPEC_REFINE, projectId, opts),

  specOnProgress: (callback: (event: SpecProgressEvent) => void) => {
    const handler = (_e: IpcRendererEvent, event: SpecProgressEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.SPEC_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SPEC_PROGRESS, handler)
  },

  specOnAutoSuggest: (callback: (projectId: string) => void) => {
    const handler = (_e: IpcRendererEvent, projectId: string) => callback(projectId)
    ipcRenderer.on(IPC_CHANNELS.SPEC_AUTO_SUGGEST, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SPEC_AUTO_SUGGEST, handler)
  },

  specList: (projectPath: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SPEC_LIST, projectPath),

  specListMilestones: (projectPath: string): Promise<MilestoneRef[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SPEC_LIST_MILESTONES, projectPath),
}

contextBridge.exposeInMainWorld('api', api)
