import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listProjects } from '../services/project-registry'
import { summarize, timeseries } from '../services/usage-store'

const EMPTY_SUMMARY = {
  totalInput: 0, totalOutput: 0, totalDurationMs: 0,
  sessionCount: 0, turnCount: 0, stoppedSessionCount: 0,
}

export function registerUsageHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.USAGE_SUMMARY, (_e, projectId: string, periodDays = 7) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return EMPTY_SUMMARY
    const toTs = Date.now()
    const fromTs = toTs - periodDays * 86_400_000
    return summarize(project.path, fromTs, toTs)
  })

  ipcMain.handle(IPC_CHANNELS.USAGE_TIMESERIES, (_e, projectId: string, periodDays = 30) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return []
    const toTs = Date.now()
    const fromTs = toTs - periodDays * 86_400_000
    return timeseries(project.path, fromTs, toTs)
  })
}
