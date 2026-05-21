import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { ChatMessage, ModelName, AgentContentBlock } from '../../shared/types'
import * as sessionStore from '../services/session-store'
import { startTurn } from '../services/agent-session'
import { pushAgentEvent } from './agent'

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
    async (_e, projectPath: string, sessionId: string, userMessage: ChatMessage, model: string) => {
      sessionStore.appendMessage(projectPath, sessionId, userMessage)

      // Build the prompt text (include any @file mentions; images referenced by path)
      const prompt = userMessage.text

      // Fire-and-forget: start the turn and stream events to renderer
      let assistantText = ''

      startTurn(
        { cwd: projectPath, sessionId, prompt, model: model || 'claude-sonnet-4-6' },
        (event) => {
          // Accumulate assistant text for session persistence
          if (event.type === 'assistant') {
            for (const block of event.message.content) {
              if (block.type === 'text') assistantText += block.text
            }
          }
          pushAgentEvent(event)
        },
        (resolvedSessionId, error) => {
          if (error) {
            pushAgentEvent({ type: 'error', message: error })
          }

          // Persist the assistant reply to the session JSONL
          if (assistantText.trim()) {
            const assistantMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: assistantText.trim(),
              ts: Date.now(),
            }
            const sid = resolvedSessionId ?? sessionId
            sessionStore.appendMessage(projectPath, sid, assistantMsg)
            pushMessage(sid, assistantMsg)
          } else if (error) {
            // Push a minimal error message so the chat doesn't stay blocked
            const errMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: `Error: ${error}`,
              ts: Date.now(),
            }
            sessionStore.appendMessage(projectPath, sessionId, errMsg)
            pushMessage(sessionId, errMsg)
          }
        }
      )
    }
  )
}
