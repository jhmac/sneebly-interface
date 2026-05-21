import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { ElectronAPI, LayoutSizes, PongPayload } from '../shared/types'

const api: ElectronAPI = {
  ping: (): Promise<PongPayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.PING),

  layoutGetSizes: (): Promise<LayoutSizes | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_GET_SIZES),

  layoutSetSizes: (sizes: LayoutSizes): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_SET_SIZES, sizes),
}

contextBridge.exposeInMainWorld('api', api)
