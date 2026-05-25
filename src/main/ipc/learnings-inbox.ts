import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listProjects } from '../services/project-registry'
import {
  listPending,
  listPromoted,
  promote,
  reject,
  revert,
  pendingCount,
  addRejectedConvention,
} from '../services/learning-store'
import { runShadowSession } from '../services/shadow-session'
import { appendOpenQuestion, revertOpenQuestion } from '../services/goals-md-updater'
import { upsertConvention, removeConvention } from '../services/conventions-md-updater'
import { tryUpdateClaudeMd } from '../services/claude-md-updater'

export function registerLearningsInboxHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LEARNINGS_LIST_PENDING, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return []
    return listPending(project.path)
  })

  ipcMain.handle(IPC_CHANNELS.LEARNINGS_LIST_PROMOTED, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return []
    return listPromoted(project.path)
  })

  ipcMain.handle(IPC_CHANNELS.LEARNINGS_PROMOTE, (_e, projectId: string, learningId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return

    const pending = listPending(project.path)
    const entry = pending.find((e) => e.id === learningId)
    if (!entry) return

    promote(project.path, learningId)

    if (entry.targetScope === 'goals-md') {
      appendOpenQuestion(project.path, entry.id, entry.proposedChange)
    } else if (entry.targetScope === 'conventions-md' && entry.conventionKey) {
      upsertConvention(project.path, entry.conventionKey, entry.title, entry.proposedChange)
      tryUpdateClaudeMd(project.path)
    }
  })

  ipcMain.handle(IPC_CHANNELS.LEARNINGS_REJECT, (_e, projectId: string, learningId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return

    const pending = listPending(project.path)
    const entry = pending.find((e) => e.id === learningId)

    reject(project.path, learningId)

    if (entry?.targetScope === 'conventions-md' && entry.conventionKey) {
      addRejectedConvention(project.path, entry.conventionKey)
    }
  })

  ipcMain.handle(IPC_CHANNELS.LEARNINGS_REVERT, (_e, projectId: string, learningId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return

    const promoted = listPromoted(project.path)
    const entry = promoted.find((e) => e.id === learningId)

    revert(project.path, learningId)

    if (entry?.targetScope === 'goals-md') {
      revertOpenQuestion(project.path, entry.id)
    } else if (entry?.targetScope === 'conventions-md' && entry.conventionKey) {
      removeConvention(project.path, entry.conventionKey)
    }
  })

  ipcMain.handle(IPC_CHANNELS.LEARNINGS_BADGE_COUNT, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return 0
    return pendingCount(project.path)
  })

  ipcMain.handle(IPC_CHANNELS.LEARNINGS_RUN_SHADOW, async (_e, projectId: string, learningId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return null
    await runShadowSession(project.path, projectId, learningId)
    return listPending(project.path).find((e) => e.id === learningId) ?? null
  })
}
