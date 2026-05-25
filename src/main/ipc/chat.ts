import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { ChatMessage, ModelName } from '../../shared/types'
import * as sessionStore from '../services/session-store'
import { startTurn } from '../services/agent-session'
import { pushAgentEvent } from './agent'
import { sendToProjectWindows } from '../services/window-registry'
import { appendEvent, CORRECTION_RE } from '../services/event-stream'

const store = new Store()

function pushMessage(sessionId: string, message: ChatMessage, projectId: string): void {
  sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, message)
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
    (_e, projectPath: string, sessionId: string) => {
      // BUG 2 FIX: clear the Claude session ID mapping so the next turn starts fresh
      store.delete(`claudeSessionIds.${sessionId}`)
      return sessionStore.clearSession(projectPath, sessionId)
    }
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
    async (_e, projectPath: string, sessionId: string, userMessage: ChatMessage, model: string, projectId: string, skillPrompt?: string) => {
      sessionStore.appendMessage(projectPath, sessionId, userMessage)

      const appSettings = store.get('appSettings', {}) as Record<string, unknown>
      const recordEvents = (appSettings['recordEventStream'] as boolean | undefined) ?? true

      if (recordEvents) {
        appendEvent(projectPath, sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          projectId: projectId ?? '',
          ts: userMessage.ts,
          kind: 'user_message',
          source: 'chat',
          payload: {
            text: userMessage.text,
            isCorrection: CORRECTION_RE.test(userMessage.text.trimStart()),
          },
        })
      }

      // BUG 2 FIX: look up Claude's session ID for this Sneebly session
      const claudeCodeSessionId = store.get(`claudeSessionIds.${sessionId}`, null) as string | null

      let assistantText = ''

      startTurn(
        {
          cwd: projectPath,
          projectId: projectId ?? '',
          sneeblySessionId: sessionId,
          claudeCodeSessionId,
          prompt: userMessage.text,
          model: model || 'claude-sonnet-4-6',
          appendSystemPrompt: skillPrompt,
          recordEvents,
        },
        (event) => {
          // BUG 2 FIX: persist Claude's session ID the moment we see system_init
          if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
            store.set(`claudeSessionIds.${sessionId}`, event.session_id)
          }

          // Accumulate assistant text for session persistence
          if (event.type === 'assistant') {
            for (const block of event.message.content) {
              if (block.type === 'text') assistantText += block.text
            }
          }

          pushAgentEvent(event, projectId)
        },
        (claudeSessionId, error) => {
          // Persist the discovered Claude session ID in case it wasn't in system_init
          if (claudeSessionId) {
            store.set(`claudeSessionIds.${sessionId}`, claudeSessionId)
          }

          if (error) {
            pushAgentEvent({ type: 'error', message: error }, projectId)
          }

          // Always use the Sneebly session ID for JSONL writes
          if (assistantText.trim()) {
            const assistantMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: assistantText.trim(),
              ts: Date.now(),
            }
            sessionStore.appendMessage(projectPath, sessionId, assistantMsg)
            pushMessage(sessionId, assistantMsg, projectId)
          } else if (error) {
            const errMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: `Error: ${error}`,
              ts: Date.now(),
            }
            sessionStore.appendMessage(projectPath, sessionId, errMsg)
            pushMessage(sessionId, errMsg, projectId)
          }
        }
      )
    }
  )
}
