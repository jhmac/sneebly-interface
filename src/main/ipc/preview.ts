import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { sendToProjectWindows } from '../services/window-registry'
import type { PreviewStatusEvent } from '../../shared/types'
import {
  startServer,
  stopServer,
  getLogs,
  setStatusCallback,
} from '../services/dev-server'

export function registerPreviewHandlers(): void {
  setStatusCallback((event: PreviewStatusEvent) => {
    sendToProjectWindows(event.projectId, IPC_CHANNELS.PREVIEW_STATUS, event)
  })

  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_START,
    (_event, projectId: string, projectPath: string): void => {
      startServer(projectId, projectPath)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_STOP,
    (_event, projectId: string): void => {
      stopServer(projectId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_RESTART,
    (_event, projectId: string, projectPath: string): void => {
      startServer(projectId, projectPath)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_GET_LOGS,
    (_event, projectId: string): string[] => {
      return getLogs(projectId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SHELL_OPEN_EXTERNAL,
    (_event, url: string): void => {
      shell.openExternal(url)
    }
  )
}
