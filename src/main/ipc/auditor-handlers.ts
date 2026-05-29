import { ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { AppSettings, AuditScope, AuditMode } from '../../shared/types'
import {
  startAudit, cancelAudit, computeEstimate, runDryRun, resolveAuditCostCap,
} from '../services/auditor/auditor-orchestrator'
import {
  listAudits, readMeta, readAllFindings, patchFinding, deleteAudit,
  getLastCompletedAudit, revealAuditDir,
} from '../services/auditor/auditor-store'
import { getProjectPath } from './design-handler-utils'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ScopeSchema = z.object({
  codeReview: z.boolean(),
  securityScan: z.boolean(),
  schemaReview: z.boolean(),
  conventionCheck: z.boolean(),
  dependencySecurityCheck: z.boolean(),
  envVarCheck: z.boolean(),
  staleTodoCheck: z.boolean(),
})

const StartOptsSchema = z.object({
  projectId: z.string().min(1),
  scope: ScopeSchema,
  mode: z.enum(['full', 'incremental', 'subset', 'dry-run']),
  subsetPaths: z.array(z.string()).optional(),
})

const AuditIdSchema = z.object({ auditId: z.string().min(1) })

const ProjectIdSchema = z.object({ projectId: z.string().min(1) })

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAuditorHandlers(getSettings: () => AppSettings): void {
  ipcMain.handle(IPC_CHANNELS.AUDIT_ESTIMATE, (_e, raw: unknown) => {
    const opts = StartOptsSchema.parse(raw)
    const s = getSettings()
    return computeEstimate(opts, s.auditorDefaultModel, s.auditorCostCeilingUsd)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_START, async (_e, raw: unknown) => {
    const opts = StartOptsSchema.parse(raw)
    const s = getSettings()
    const auditId = await startAudit(opts, {
      model: s.auditorDefaultModel,
      concurrency: s.auditorMaxConcurrency,
      costCeilingUsd: s.auditorCostCeilingUsd,
      excerptContextLines: s.auditorExcerptContextLines,
      notifyOnCompletion: s.auditorNotifyOnCompletion,
      bounceDockOnCompletion: s.auditorBounceDockOnCompletion,
      includeBusinessImpact: s.auditorIncludeBusinessImpact,
    })
    return { auditId }
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_CANCEL, (_e, raw: unknown) => {
    const { auditId } = AuditIdSchema.parse(raw)
    // Find which project this audit belongs to and cancel
    cancelAudit(auditId, '')
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_RESUME_FROM_COST_CAP, (_e, raw: unknown) => {
    const { auditId } = AuditIdSchema.parse(raw)
    resolveAuditCostCap(auditId)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_LIST, (_e, raw: unknown) => {
    const { projectId } = ProjectIdSchema.parse(raw)
    const projectPath = getProjectPath(projectId)
    return listAudits(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_GET, (_e, raw: unknown) => {
    const schema = z.object({ auditId: z.string().min(1), projectId: z.string().min(1) })
    const { auditId, projectId } = schema.parse(raw)
    const projectPath = getProjectPath(projectId)
    const meta = readMeta(projectPath, auditId)
    if (!meta) return null
    const findings = readAllFindings(projectPath, auditId)
    return { meta, findings }
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_MARK_RESOLVED, (_e, raw: unknown) => {
    const schema = z.object({
      auditId: z.string().min(1),
      projectId: z.string().min(1),
      findingId: z.string().min(1),
      resolved: z.boolean(),
    })
    const { auditId, projectId, findingId, resolved } = schema.parse(raw)
    const projectPath = getProjectPath(projectId)
    patchFinding(projectPath, auditId, findingId, {
      resolved,
      resolvedAt: resolved ? Date.now() : null,
    })
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_MARK_FALSE_POSITIVE, (_e, raw: unknown) => {
    const schema = z.object({
      auditId: z.string().min(1),
      projectId: z.string().min(1),
      findingId: z.string().min(1),
      falsePositive: z.boolean(),
      reason: z.string().optional(),
    })
    const { auditId, projectId, findingId, falsePositive, reason } = schema.parse(raw)
    const projectPath = getProjectPath(projectId)
    patchFinding(projectPath, auditId, findingId, {
      falsePositive,
      falsePositiveReason: falsePositive ? (reason ?? null) : null,
    })
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_DELETE, (_e, raw: unknown) => {
    const schema = z.object({ auditId: z.string().min(1), projectId: z.string().min(1) })
    const { auditId, projectId } = schema.parse(raw)
    const projectPath = getProjectPath(projectId)
    deleteAudit(projectPath, auditId)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_DRY_RUN, (_e, raw: unknown) => {
    const opts = StartOptsSchema.parse(raw)
    const s = getSettings()
    return runDryRun(opts, s.auditorDefaultModel, s.auditorCostCeilingUsd)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_GET_LAST, (_e, raw: unknown) => {
    const { projectId } = ProjectIdSchema.parse(raw)
    const projectPath = getProjectPath(projectId)
    return getLastCompletedAudit(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_REVEAL_IN_FINDER, (_e, raw: unknown) => {
    const schema = z.object({ auditId: z.string().min(1), projectId: z.string().min(1) })
    const { auditId, projectId } = schema.parse(raw)
    const projectPath = getProjectPath(projectId)
    revealAuditDir(projectPath, auditId)
  })
}
