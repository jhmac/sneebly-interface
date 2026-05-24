import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { abortSession } from '../services/agent-session'
import { sendToProjectWindows, broadcastToAllWindows } from '../services/window-registry'
import type { AgentEvent } from '../../shared/types'

// If projectId is provided, routes to windows watching that project.
// Falls back to broadcast for daemon events (cycle.ts calls without projectId).
export function pushAgentEvent(event: AgentEvent, projectId?: string): void {
  const stamped: AgentEvent = projectId ? { ...event, projectId } : event
  if (projectId) {
    sendToProjectWindows(projectId, IPC_CHANNELS.AGENT_EVENT, stamped)
  } else {
    broadcastToAllWindows(IPC_CHANNELS.AGENT_EVENT, stamped)
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
