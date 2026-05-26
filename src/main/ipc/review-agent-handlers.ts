import { ipcMain } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { AppSettings, ModelName } from '../../shared/types'
import { sendToProjectWindows } from '../services/window-registry'
import { startReview, cancelReview, recordReviewAction } from '../services/review-agent'

const store = new Store()

const StartSchema = z.object({
  projectId: z.string().min(1),
  milestoneId: z.string().min(1),
})

export function registerReviewAgentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.REVIEW_AGENT_START, (_e, raw: unknown) => {
    const opts = StartSchema.parse(raw)
    const settings = store.get('appSettings', {}) as Partial<AppSettings>
    if (settings.reviewAgentEnabled === false) {
      throw new Error('Review Agent is disabled in settings')
    }
    const model = (settings.reviewAgentModel as ModelName | undefined) ?? 'claude-opus-4-7'
    const turnId = startReview(opts.projectId, opts.milestoneId, model, {
      onThinking: (tid, status) =>
        sendToProjectWindows(opts.projectId, IPC_CHANNELS.REVIEW_AGENT_THINKING, tid, status),
      onDone: (tid, result, error) =>
        sendToProjectWindows(opts.projectId, IPC_CHANNELS.REVIEW_AGENT_DONE, tid, result, error),
    })
    return { turnId }
  })

  ipcMain.handle(IPC_CHANNELS.REVIEW_AGENT_CANCEL, (_e, turnId: unknown) => {
    cancelReview(z.string().parse(turnId))
  })

  ipcMain.handle(IPC_CHANNELS.REVIEW_AGENT_ACTION, (_e, raw: unknown) => {
    const a = z.object({ projectId: z.string(), milestoneId: z.string(), action: z.string() }).parse(raw)
    recordReviewAction(a.projectId, a.milestoneId, a.action)
  })
}
