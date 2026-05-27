import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listProjects } from '../services/project-registry'
import {
  runPreflightDecider,
  runAuditDecider,
  resolveSkippedWithDecider,
  buildReviewPrompt,
  loadDecisions,
  countFlaggedDecisions,
} from '../services/decider-orchestrator'
import { sendToProjectWindows } from '../services/window-registry'
import { initDeciderReviewBridge } from '../services/decider-review-bridge'

function projectPath(projectId: string): string | null {
  return listProjects().find((p) => p.id === projectId)?.path ?? null
}

export function registerDeciderHandlers(): void {
  // Start the review bridge (listens on agentBus for review:done events)
  initDeciderReviewBridge()

  // ── Pre-flight ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DECIDER_RUN_PREFLIGHT,
    async (_e, projectId: string, milestoneId: string) => {
      const result = await runPreflightDecider(projectId, milestoneId)
      if (result) {
        sendToProjectWindows(projectId, IPC_CHANNELS.DECIDER_DECISIONS_UPDATED, projectId)
      }
      return result
    },
  )

  // ── Audit ───────────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DECIDER_RUN_AUDIT,
    async (_e, projectId: string, milestoneId: string) => {
      const result = await runAuditDecider(projectId, milestoneId)
      if (result) {
        sendToProjectWindows(projectId, IPC_CHANNELS.DECIDER_DECISIONS_UPDATED, projectId)
      }
      return result
    },
  )

  // ── Get decisions file ──────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DECIDER_GET_DECISIONS,
    (_e, projectId: string, milestoneId: string, isAudit = false) => {
      const path = projectPath(projectId)
      if (!path) return null
      return loadDecisions(path, milestoneId, isAudit)
    },
  )

  // ── Flagged count ───────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DECIDER_GET_FLAGGED_COUNT,
    (_e, projectId: string) => {
      const path = projectPath(projectId)
      if (!path) return 0
      return countFlaggedDecisions(path)
    },
  )

  // ── Review prompt ───────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DECIDER_GET_REVIEW_PROMPT,
    (_e, projectId: string, milestoneId: string) => {
      return buildReviewPrompt(projectId, milestoneId)
    },
  )

  // ── Resolve skipped (atomic: unskip + preflight) ─────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DECIDER_RESOLVE_SKIPPED,
    async (_e, projectId: string, milestoneId: string) => {
      const result = await resolveSkippedWithDecider(projectId, milestoneId)
      // Signal whenever the run completed (even 0 decisions), so the badge
      // re-fetches and clears any stale count from a previous decisions file.
      if (result) {
        sendToProjectWindows(projectId, IPC_CHANNELS.DECIDER_DECISIONS_UPDATED, projectId)
      }
      return result
    },
  )
}
