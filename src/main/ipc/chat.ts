import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { ChatMessage, ModelName } from '../../shared/types'
import * as sessionStore from '../services/session-store'
import { sendEchoReply } from '../services/echo-agent'

const store = new Store()

function pushMessage(sessionId: string, message: ChatMessage): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, message)
  }
}

export function registerChatHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, (_e, projectPath: string) =>
    sessionStore.listSessions(projectPath)
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_LOAD,
    (_e, projectPath: string, sessionId: string) =>
      sessionStore.loadMessages(projectPath, sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, (_e, projectPath: string) =>
    sessionStore.createSession(projectPath)
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_CLEAR,
    (_e, projectPath: string, sessionId: string) =>
      sessionStore.clearSession(projectPath, sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_ACTIVE, (_e, projectId: string) =>
    store.get(`chat.activeSession.${projectId}`, null)
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_SET_ACTIVE,
    (_e, projectId: string, sessionId: string | null) => {
      if (sessionId) {
        store.set(`chat.activeSession.${projectId}`, sessionId)
      } else {
        store.delete(`chat.activeSession.${projectId}`)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.MODEL_GET, () =>
    store.get('chat.defaultModel', 'claude-sonnet-4-6')
  )

  ipcMain.handle(IPC_CHANNELS.MODEL_SET, (_e, model: ModelName) => {
    store.set('chat.defaultModel', model)
  })

  ipcMain.handle(
    IPC_CHANNELS.CHAT_SEND,
    async (_e, projectPath: string, sessionId: string, userMessage: ChatMessage) => {
      sessionStore.appendMessage(projectPath, sessionId, userMessage)
      // Renderer shows user message optimistically; only push the echo reply
      sendEchoReply(projectPath, sessionId, userMessage, pushMessage).catch(console.error)
    }
  )
}
