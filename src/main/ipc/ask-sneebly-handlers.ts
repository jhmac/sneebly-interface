import { ipcMain } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { AppSettings, ModelName } from '../../shared/types'
import { sendToProjectWindows } from '../services/window-registry'
import { startAskSneeblyTurn, cancelAskSneeblyTurn } from '../services/ask-sneebly'

const store = new Store()

const StartSchema = z.object({
  projectId: z.string().min(1),
  question: z.string().min(1),
  conversationId: z.string().min(1),
  includeDiff: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
})

export function registerAskSneeblyHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ASK_SNEEBLY_START, (_e, raw: unknown) => {
    const opts = StartSchema.parse(raw)
    const settings = store.get('appSettings', {}) as Partial<AppSettings>
    if (settings.askSneeblyEnabled === false) {
      throw new Error('Ask Sneebly is disabled in settings')
    }
    const model = (settings.askSneeblyModel as ModelName | undefined) ?? 'claude-sonnet-4-6'
    const turnId = startAskSneeblyTurn(opts, model, {
      onChunk: (tid, chunk) =>
        sendToProjectWindows(opts.projectId, IPC_CHANNELS.ASK_SNEEBLY_CHUNK, tid, chunk),
      onThinking: (tid, status) =>
        sendToProjectWindows(opts.projectId, IPC_CHANNELS.ASK_SNEEBLY_THINKING, tid, status),
      onDone: (tid, error) =>
        sendToProjectWindows(opts.projectId, IPC_CHANNELS.ASK_SNEEBLY_DONE, tid, error),
    })
    return { turnId }
  })

  ipcMain.handle(IPC_CHANNELS.ASK_SNEEBLY_CANCEL, (_e, turnId: unknown) => {
    cancelAskSneeblyTurn(z.string().parse(turnId))
  })
}
