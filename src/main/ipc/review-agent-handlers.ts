import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { fireReview, cancelReview, recordReviewAction } from '../services/review-agent'

const StartSchema = z.object({
  projectId: z.string().min(1),
  milestoneId: z.string().min(1),
})

export function registerReviewAgentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.REVIEW_AGENT_START, (_e, raw: unknown) => {
    const opts = StartSchema.parse(raw)
    const turnId = fireReview(opts.projectId, opts.milestoneId, false)
    if (!turnId) throw new Error('Review Agent is disabled in settings')
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
