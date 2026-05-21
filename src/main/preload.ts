import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { ElectronAPI, PongPayload } from '../shared/types'

const api: ElectronAPI = {
  ping: (): Promise<PongPayload> => ipcRenderer.invoke(IPC_CHANNELS.PING),
}

contextBridge.exposeInMainWorld('api', api)
