import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  ElectronAPI,
  LayoutSizes,
  PongPayload,
  Project,
  ProjectActivateResult,
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
}

contextBridge.exposeInMainWorld('api', api)
