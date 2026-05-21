import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  ElectronAPI,
  LayoutSizes,
  PongPayload,
  Project,
  ProjectActivateResult,
  PreviewStatusEvent,
  ChatMessage,
  SessionSummary,
  ModelName,
  AgentEvent,
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
}

contextBridge.exposeInMainWorld('api', api)
