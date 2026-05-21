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
} from '../shared/types'

const api: ElectronAPI = {
  ping: (): Promise<PongPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.PING),

  layoutGetSizes: (): Promise<LayoutSizes | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_GET_SIZES),

  layoutSetSizes: (sizes: LayoutSizes): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_SET_SIZES, sizes),

  projectList: (): Promise<Project[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),

  projectOpenDialog: (): Promise<Project | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_OPEN_DIALOG),

  projectActivate: (id: string): Promise<ProjectActivateResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_ACTIVATE, id),

  previewStart: (projectId: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_START, projectId, projectPath),

  previewStop: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_STOP, projectId),

  previewRestart: (projectId: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_RESTART, projectId, projectPath),

  previewGetLogs: (projectId: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_GET_LOGS, projectId),

  previewOnStatus: (callback: (event: PreviewStatusEvent) => void): (() => void) => {
    const handler = (_ipcEvent: IpcRendererEvent, statusEvent: PreviewStatusEvent) => {
      callback(statusEvent)
    }
    ipcRenderer.on(IPC_CHANNELS.PREVIEW_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PREVIEW_STATUS, handler)
  },

  shellOpenExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
}

contextBridge.exposeInMainWorld('api', api)
