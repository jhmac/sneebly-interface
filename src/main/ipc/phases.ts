import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { PhaseRunConfig } from '../../shared/types'
import { listProjects } from '../services/project-registry'
import { generatePhasePlan } from '../services/phase-orderer'
import {
  loadPhasePlan,
  savePhasePlan,
  syncCheckedState,
  markMilestoneComplete,
  markMilestoneSkipped,
  unmarkMilestoneSkipped,
  getMilestoneById,
} from '../services/phase-tracker'
import { startRun, stopRun, getRunState, skipCurrentMilestone } from '../services/phase-runner'
import { auditPhasePlan, stopAudit } from '../services/phase-auditor'
import { fireReview } from '../services/review-agent'

function projectPath(projectId: string): string | null {
  return listProjects().find((p) => p.id === projectId)?.path ?? null
}

export function registerPhaseHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PHASE_PLAN_GET, (_e, projectId: string) => {
    const path = projectPath(projectId)
    if (!path) return null
    const plan = loadPhasePlan(path)
    if (!plan) return null
    return syncCheckedState(path, plan)
  })

  ipcMain.handle(IPC_CHANNELS.PHASE_PLAN_GENERATE, async (_e, projectId: string) => {
    const path = projectPath(projectId)
    if (!path) throw new Error(`Project ${projectId} not found`)
    const plan = await generatePhasePlan(path, projectId)
    // Sync checked state with current GOALS.md before saving
    const synced = syncCheckedState(path, plan)
    savePhasePlan(path, synced)
    return synced
  })

  ipcMain.handle(
    IPC_CHANNELS.PHASE_MILESTONE_COMPLETE,
    (_e, projectId: string, milestoneId: string) => {
      const path = projectPath(projectId)
      if (!path) throw new Error(`Project ${projectId} not found`)
      const plan = markMilestoneComplete(path, milestoneId)
      // Auto-fire the Review Agent (log-only, fire-and-forget). Self-gates on settings.
      try { fireReview(projectId, milestoneId, true) } catch { /* never block mark-complete */ }
      return plan
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PHASE_MILESTONE_SKIP,
    (_e, projectId: string, milestoneId: string, reason?: string) => {
      const path = projectPath(projectId)
      if (!path) throw new Error(`Project ${projectId} not found`)
      return markMilestoneSkipped(path, milestoneId, reason)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PHASE_MILESTONE_UNSKIP,
    (_e, projectId: string, milestoneId: string) => {
      const path = projectPath(projectId)
      if (!path) throw new Error(`Project ${projectId} not found`)
      return unmarkMilestoneSkipped(path, milestoneId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PHASE_SKIP_CURRENT,
    (_e, projectId: string) => skipCurrentMilestone(projectId)
  )

  ipcMain.handle(
    IPC_CHANNELS.PHASE_RUN_START,
    (_e, projectId: string, config: PhaseRunConfig) => startRun(projectId, config)
  )

  ipcMain.handle(IPC_CHANNELS.PHASE_RUN_STOP, (_e, projectId: string) => {
    stopRun(projectId)
  })

  ipcMain.handle(IPC_CHANNELS.PHASE_RUN_STATE, (_e, projectId: string) => {
    return getRunState(projectId)
  })

  ipcMain.handle(
    IPC_CHANNELS.PHASE_KICKOFF_FILL,
    (_e, projectId: string, milestoneId: string) => {
      const path = projectPath(projectId)
      if (!path) return null
      const plan = loadPhasePlan(path)
      if (!plan) return null
      const milestone = getMilestoneById(plan, milestoneId)
      if (!milestone) return null
      return { text: milestone.kickoffPrompt, specPath: milestone.specPath }
    }
  )

  ipcMain.handle(IPC_CHANNELS.PHASE_AUDIT, async (_e, projectId: string) => {
    const path = projectPath(projectId)
    if (!path) throw new Error(`Project ${projectId} not found`)
    return auditPhasePlan(path, projectId)
  })

  ipcMain.handle(IPC_CHANNELS.PHASE_AUDIT_STOP, (_e, projectId: string) => {
    stopAudit(projectId)
  })
}
