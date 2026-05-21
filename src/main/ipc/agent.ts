import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { abortSession } from '../services/agent-session'
import type { AgentEvent } from '../../shared/types'

export function pushAgentEvent(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.AGENT_EVENT, event)
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_ABORT, (_e, sessionId: string) => {
    abortSession(sessionId)
  })

  ipcMain.handle(
    IPC_CHANNELS.AGENT_PERMISSION_RESPONSE,
    (_e, _requestId: string, _decision: 'allow' | 'deny') => {
      // Phase 5: permission-mode is acceptEdits; bash prompts surfaced as cards.
      // Permission decisions are noted here for future interactive handling.
    }
  )
}
