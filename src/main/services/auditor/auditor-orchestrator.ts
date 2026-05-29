import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import type {
  AuditId, AuditMeta, AuditFinding, AuditProgressEvent, AuditStatus,
  AuditStartOpts, AuditEstimate, AuditScope, AuditDryRunResult, ModelName,
} from '../../../shared/types'
import { walkProjectFiles } from './auditor-file-scope'
import { resolveMode } from './auditor-mode'
import { estimateAudit } from './auditor-cost-estimator'
import { AuditorPool } from './auditor-pool'
import { runPass, runCodeReviewBatch } from './auditor-pass-runner'
import {
  CODE_REVIEW_SYSTEM_PROMPT,
  SECURITY_SCAN_SYSTEM_PROMPT,
  SCHEMA_REVIEW_SYSTEM_PROMPT,
  CONVENTION_CHECK_SYSTEM_PROMPT,
  DEPSEC_REVIEW_SYSTEM_PROMPT,
  ENV_VAR_CHECK_SYSTEM_PROMPT,
  STALE_TODO_SYSTEM_PROMPT,
} from './auditor-system-prompts'
import {
  initAuditDir, writeMeta, readMeta, writeFinding, readAllFindings,
  generateAuditId, removePid, appendLog, auditDir,
} from './auditor-store'
import { loadAuditRules } from './auditor-rules-loader'
import { detectTodos, detectEnvRefs, readEnvExample } from './auditor-detectors'
import { runPackageAudit } from './auditor-depsec-checker'
import { deduplicateFindings, prioritiseFindings, writeReport } from './auditor-synthesizer'
import { notifyAuditComplete, notifyCostCapReached, setDockBadge, clearDockBadge } from './auditor-notifications'
import { ProgressEstimator } from './auditor-progress-estimator'
import { agentBus } from '../agent-bus'
import { getProjectPath } from '../../ipc/design-handler-utils'

// ─── Active audit registry ────────────────────────────────────────────────────
// One audit per project; map: projectId → AuditId

const activeAudits = new Map<string, AuditId>()

export function getActiveAuditId(projectId: string): AuditId | null {
  return activeAudits.get(projectId) ?? null
}

// ─── Cost ceiling ─────────────────────────────────────────────────────────────

const ABSOLUTE_COST_CEILING_USD = 200

// ─── Push event helpers ───────────────────────────────────────────────────────

function sendToAll(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

function buildProgressEvent(
  auditId: AuditId,
  meta: AuditMeta,
  phase: AuditProgressEvent['phase'],
  phaseName: string,
  phaseProcessed: number,
  phaseTotal: number,
  findings: AuditFinding[],
  estimator: ProgressEstimator,
  message?: string,
): AuditProgressEvent {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) bySeverity[f.severity]++
  const last = findings[findings.length - 1]

  return {
    auditId,
    phase,
    phaseName,
    filesProcessedInPhase: phaseProcessed,
    totalFilesInPhase: phaseTotal,
    totalProcessed: meta.processedFiles,
    totalFiles: meta.totalFiles,
    findingsAccumulated: findings.length,
    bySeverity,
    lastFinding: last ? { title: last.title, severity: last.severity, category: last.category } : undefined,
    message,
    estimatedRemainingMs: estimator.estimateRemainingMs(meta.processedFiles),
    currentSpendUsd: meta.costActualUsd,
    estimatedTotalUsd: meta.costEstimateUsdMax,
  }
}

// ─── Throttled progress emit ──────────────────────────────────────────────────

function makeProgressThrottle() {
  let lastEmit = 0
  return (event: AuditProgressEvent) => {
    const now = Date.now()
    if (now - lastEmit >= 500) {
      lastEmit = now
      sendToAll(IPC_CHANNELS.AUDIT_PROGRESS, event)
      // Update dock badge with percentage
      const pct = event.totalFiles > 0
        ? Math.round((event.totalProcessed / event.totalFiles) * 100)
        : 0
      setDockBadge(`${pct}%`)
    }
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function startAudit(
  opts: AuditStartOpts,
  settings: {
    model: ModelName
    concurrency: number
    costCeilingUsd: number
    excerptContextLines: number
    notifyOnCompletion: boolean
    bounceDockOnCompletion: boolean
    includeBusinessImpact: boolean
  },
): Promise<AuditId> {
  const projectPath = getProjectPath(opts.projectId)

  if (activeAudits.has(opts.projectId)) {
    throw new Error('An audit is already running for this project')
  }

  // Validate audit rules before starting
  let auditRules: ReturnType<typeof loadAuditRules> = null
  try {
    auditRules = loadAuditRules(projectPath)
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)}`)
  }

  const auditId = generateAuditId(projectPath)
  activeAudits.set(opts.projectId, auditId)

  // Kick off async — return auditId immediately
  void runAuditAsyncSafe(auditId, projectPath, opts, settings, auditRules)

  return auditId
}

// ─── Cost ceiling check ───────────────────────────────────────────────────────

let pendingCostCapResolutions = new Map<AuditId, () => void>()

export function resolveAuditCostCap(auditId: AuditId): void {
  const resolve = pendingCostCapResolutions.get(auditId)
  if (resolve) {
    pendingCostCapResolutions.delete(auditId)
    resolve()
  }
}

// ─── Async audit runner ───────────────────────────────────────────────────────

async function runAuditAsync(
  auditId: AuditId,
  projectPath: string,
  opts: AuditStartOpts,
  settings: {
    model: ModelName
    concurrency: number
    costCeilingUsd: number
    excerptContextLines: number
    notifyOnCompletion: boolean
    bounceDockOnCompletion: boolean
    includeBusinessImpact: boolean
  },
  auditRules: ReturnType<typeof loadAuditRules>,
): Promise<void> {
  const allFindings: AuditFinding[] = []
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalCostUsd = 0
  let processedFiles = 0
  let failedFiles = 0

  const emitProgress = makeProgressThrottle()
  const pool = new AuditorPool(Math.min(settings.concurrency, 8))

  // ── Phase 1: Discovery ──────────────────────────────────────────────────────
  const { files: allFiles } = walkProjectFiles(
    projectPath,
    auditRules?.ignoredFilePatterns ?? [],
  )

  const { effectiveMode, filesToAudit, carriedForwardFiles, baseAuditId, changedFiles, fallbackReason } =
    resolveMode(opts.mode, allFiles, projectPath, opts.subsetPaths)

  const estimator = new ProgressEstimator(filesToAudit.length)
  const estimate = estimateAudit(filesToAudit, opts.scope, settings.model, settings.costCeilingUsd)

  const meta: AuditMeta = {
    id: auditId,
    spec: 'v1',
    projectId: opts.projectId,
    projectPath,
    startedAt: Date.now(),
    completedAt: null,
    status: 'running',
    mode: effectiveMode,
    scope: opts.scope,
    model: settings.model,
    costEstimateUsdMin: estimate.estimatedCostUsdMin,
    costEstimateUsdMax: estimate.estimatedCostUsdMax,
    costActualUsd: 0,
    costCeilingUsd: Math.min(settings.costCeilingUsd, ABSOLUTE_COST_CEILING_USD),
    tokensIn: 0,
    tokensOut: 0,
    totalFiles: filesToAudit.length,
    processedFiles: 0,
    failedFiles: 0,
    concurrencyLimit: settings.concurrency,
    pid: process.pid,
    notificationSent: false,
    subsetPaths: opts.subsetPaths,
    incrementalBaseAuditId: baseAuditId,
    changedFiles,
    carriedForwardCount: carriedForwardFiles.length,
    newFindingsCount: 0,
  }

  initAuditDir(projectPath, auditId, meta)
  appendLog(projectPath, auditId, { event: 'audit_started', mode: effectiveMode, files: filesToAudit.length })

  if (fallbackReason) {
    sendToAll(IPC_CHANNELS.AUDIT_PROGRESS, {
      auditId, phase: 1, phaseName: 'Discovery', message: fallbackReason,
      filesProcessedInPhase: 0, totalFilesInPhase: 0, totalProcessed: 0,
      totalFiles: filesToAudit.length, findingsAccumulated: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      estimatedRemainingMs: 0, currentSpendUsd: 0,
      estimatedTotalUsd: estimate.estimatedCostUsdMax,
    })
  }

  agentBus.emit('audit:started', opts.projectId, auditId)

  // ── Helper: persist finding ─────────────────────────────────────────────────
  function saveFinding(f: AuditFinding): void {
    allFindings.push(f)
    writeFinding(projectPath, auditId, f)
  }

  // ── Helper: accumulate LLM result ──────────────────────────────────────────
  function accumulateCost(tokens: { tokensIn: number; tokensOut: number; costUsd: number }): void {
    totalTokensIn += tokens.tokensIn
    totalTokensOut += tokens.tokensOut
    totalCostUsd += tokens.costUsd
    meta.tokensIn = totalTokensIn
    meta.tokensOut = totalTokensOut
    meta.costActualUsd = totalCostUsd
    writeMeta(projectPath, auditId, meta)
  }

  // ── Helper: cost ceiling check ─────────────────────────────────────────────
  async function checkCostCeiling(): Promise<boolean> {
    const ceiling = Math.min(settings.costCeilingUsd, ABSOLUTE_COST_CEILING_USD)
    if (totalCostUsd < ceiling) return true // OK to continue

    if (totalCostUsd >= ABSOLUTE_COST_CEILING_USD) {
      // Hard cap — auto-cancel
      pool.cancel()
      await finishAudit('canceled', 'Hard cost ceiling of $200 reached')
      return false
    }

    // Soft cap — pause and wait for user decision
    pool.pause()
    meta.status = 'awaiting-budget-decision'
    writeMeta(projectPath, auditId, meta)
    notifyCostCapReached(projectPath.split('/').pop() ?? projectPath, totalCostUsd, ceiling)
    sendToAll(IPC_CHANNELS.AUDIT_PROGRESS, {
      auditId, phase: 2, phaseName: 'Code Review',
      message: `Cost cap reached ($${totalCostUsd.toFixed(2)}). Waiting for your decision.`,
      filesProcessedInPhase: 0, totalFilesInPhase: 0,
      totalProcessed: processedFiles, totalFiles: filesToAudit.length,
      findingsAccumulated: allFindings.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      estimatedRemainingMs: 0, currentSpendUsd: totalCostUsd,
      estimatedTotalUsd: estimate.estimatedCostUsdMax,
    })

    await new Promise<void>((resolve) => {
      pendingCostCapResolutions.set(auditId, resolve)
    })

    // If the audit was canceled while we were waiting, abort now.
    if (pool.isCanceled) return false

    // User chose to continue — increase ceiling by 50%
    settings.costCeilingUsd = Math.min(settings.costCeilingUsd * 1.5, ABSOLUTE_COST_CEILING_USD)
    meta.costCeilingUsd = settings.costCeilingUsd
    meta.status = 'running'
    writeMeta(projectPath, auditId, meta)
    pool.resume()
    return true
  }

  // ── Helper: finish audit ───────────────────────────────────────────────────
  async function finishAudit(status: AuditStatus, error?: string): Promise<void> {
    activeAudits.delete(opts.projectId)
    pool.cancel()

    const dedupedFindings = deduplicateFindings(allFindings)
    const prioritised = prioritiseFindings(dedupedFindings)
    meta.status = status
    meta.completedAt = Date.now()
    meta.error = error
    meta.newFindingsCount = prioritised.length
    writeMeta(projectPath, auditId, meta)
    removePid(projectPath, auditId)
    writeReport(projectPath, auditId, meta, prioritised)

    const criticalCount = prioritised.filter((f) => f.severity === 'critical').length
    clearDockBadge()

    if (settings.bounceDockOnCompletion && criticalCount > 0 && process.platform === 'darwin') {
      app.dock?.bounce('critical')
    }

    if (settings.notifyOnCompletion) {
      notifyAuditComplete(
        projectPath.split('/').pop() ?? projectPath,
        status,
        prioritised.length,
        criticalCount,
      )
    }

    sendToAll(IPC_CHANNELS.AUDIT_DONE, auditId, status)
    agentBus.emit('audit:done', opts.projectId, auditId, status, prioritised.length)
    appendLog(projectPath, auditId, { event: 'audit_finished', status, findings: prioritised.length })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 1: Env var check (no LLM needed for detection; LLM for judgment below)
  // Phase 1: TODO detection (grep-based, no LLM)
  // Both run synchronously during discovery

  const sourceFiles = filesToAudit.filter((f) => f.category === 'source')
  const schemaFiles = filesToAudit.filter((f) => f.category === 'schema')
  const securityFiles = filesToAudit.filter((f) => f.category === 'source' && f.importance === 'high')

  const todos = opts.scope.staleTodoCheck ? detectTodos(sourceFiles) : []
  const envRefs = opts.scope.envVarCheck ? detectEnvRefs(sourceFiles) : []
  const envExampleKeys = opts.scope.envVarCheck ? readEnvExample(projectPath) : []

  // ── Phases 2/3/5: run in parallel via pool ──────────────────────────────────

  const phase2Tasks: Promise<void>[] = []
  const phase3Tasks: Promise<void>[] = []
  const phase5Tasks: Promise<void>[] = []

  // Load CLAUDE.md for convention check
  let claudeMd = ''
  const claudeMdPath = join(projectPath, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    try { claudeMd = readFileSync(claudeMdPath, 'utf-8').slice(0, 8_000) } catch { /* skip */ }
  }

  const extraConventions = (auditRules?.conventionsExtension ?? []).join('\n')

  // Phase 2: code review (batched)
  if (opts.scope.codeReview && sourceFiles.length > 0) {
    const BATCH_SIZE_FILES = 10
    for (let i = 0; i < sourceFiles.length; i += BATCH_SIZE_FILES) {
      const batch = sourceFiles.slice(i, i + BATCH_SIZE_FILES)
      phase2Tasks.push(pool.add(async () => {
        try {
          const r = await runCodeReviewBatch(batch, {
            projectId: opts.projectId,
            projectPath,
            systemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
            model: settings.model,
            phase: 2,
          })
          r.findings.forEach(saveFinding)
          accumulateCost(r)
          processedFiles += batch.length
          meta.processedFiles = processedFiles
          estimator.update(processedFiles)
          emitProgress(buildProgressEvent(auditId, meta, 2, 'Code Review', i, sourceFiles.length, allFindings, estimator))
        } catch (err) {
          failedFiles += batch.length
          meta.failedFiles = failedFiles
          appendLog(projectPath, auditId, { event: 'phase2_batch_error', error: String(err) })
        }
        await checkCostCeiling()
      }))
    }
  }

  // Phase 3: security scan (high-importance files)
  if (opts.scope.securityScan && securityFiles.length > 0) {
    for (const file of securityFiles) {
      const f = file
      phase3Tasks.push(pool.add(async () => {
        try {
          let content: string
          try { content = readFileSync(f.absolutePath, 'utf-8') } catch { return }
          const lines = content.split('\n')
          const numbered = lines.map((l, idx) => `${idx + 1}: ${l}`).join('\n')
          const r = await runPass({
            projectId: opts.projectId, projectPath,
            systemPrompt: SECURITY_SCAN_SYSTEM_PROMPT,
            userMessage: `relativePath: ${f.relativePath}\ncontent:\n${numbered}`,
            model: settings.model, phase: 3, defaultCategory: 'security',
          })
          r.findings.forEach(saveFinding)
          accumulateCost(r)
        } catch (err) {
          appendLog(projectPath, auditId, { event: 'phase3_error', file: f.relativePath, error: String(err) })
        }
        await checkCostCeiling()
      }))
    }
  }

  // Phase 5: convention check (sample of source files)
  if (opts.scope.conventionCheck && claudeMd && sourceFiles.length > 0) {
    const sampleFiles = sourceFiles.slice(0, 20)
    phase5Tasks.push(pool.add(async () => {
      try {
        const fileContents = sampleFiles.map((f) => {
          try {
            const lines = readFileSync(f.absolutePath, 'utf-8').split('\n')
            return `=== ${f.relativePath} ===\n${lines.slice(0, 200).map((l, i) => `${i + 1}: ${l}`).join('\n')}`
          } catch { return '' }
        }).filter(Boolean).join('\n\n')

        const prompt = `CLAUDE.md (project conventions):\n${claudeMd}${extraConventions ? `\n\nEXTRA CONVENTIONS:\n${extraConventions}` : ''}\n\nFiles to check:\n${fileContents}`
        const r = await runPass({
          projectId: opts.projectId, projectPath,
          systemPrompt: CONVENTION_CHECK_SYSTEM_PROMPT,
          userMessage: prompt,
          model: settings.model, phase: 5, defaultCategory: 'convention',
        })
        r.findings.forEach(saveFinding)
        accumulateCost(r)
      } catch (err) {
        appendLog(projectPath, auditId, { event: 'phase5_error', error: String(err) })
      }
    }))
  }

  // Wait for phases 2/3/5
  await Promise.allSettled([...phase2Tasks, ...phase3Tasks, ...phase5Tasks])

  if (pool.isCanceled) {
    await finishAudit('canceled')
    return
  }

  // ── Phase 4: schema review ──────────────────────────────────────────────────
  if (opts.scope.schemaReview && schemaFiles.length > 0) {
    sendToAll(IPC_CHANNELS.AUDIT_PROGRESS, {
      auditId, phase: 4, phaseName: 'Schema Review', message: `Reviewing ${schemaFiles.length} schema file(s)…`,
      filesProcessedInPhase: 0, totalFilesInPhase: schemaFiles.length,
      totalProcessed: processedFiles, totalFiles: filesToAudit.length,
      findingsAccumulated: allFindings.length, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      estimatedRemainingMs: 0, currentSpendUsd: totalCostUsd, estimatedTotalUsd: estimate.estimatedCostUsdMax,
    })
    for (const schemaFile of schemaFiles) {
      const sf = schemaFile
      try {
        let content: string
        try { content = readFileSync(sf.absolutePath, 'utf-8') } catch { continue }
        const numbered = content.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')
        const r = await runPass({
          projectId: opts.projectId, projectPath,
          systemPrompt: SCHEMA_REVIEW_SYSTEM_PROMPT,
          userMessage: `relativePath: ${sf.relativePath}\ncontent:\n${numbered}`,
          model: settings.model, phase: 4, defaultCategory: 'schema',
        })
        r.findings.forEach(saveFinding)
        accumulateCost(r)
      } catch (err) {
        appendLog(projectPath, auditId, { event: 'phase4_error', file: sf.relativePath, error: String(err) })
      }
    }
  }

  if (pool.isCanceled) { await finishAudit('canceled'); return }

  // ── Phase 6: dependency security / env vars / todos ─────────────────────────
  sendToAll(IPC_CHANNELS.AUDIT_PROGRESS, {
    auditId, phase: 6, phaseName: 'Dep Security / Env / TODO',
    message: 'Running dependency security, env var, and TODO checks…',
    filesProcessedInPhase: 0, totalFilesInPhase: 0,
    totalProcessed: processedFiles, totalFiles: filesToAudit.length,
    findingsAccumulated: allFindings.length, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    estimatedRemainingMs: 0, currentSpendUsd: totalCostUsd, estimatedTotalUsd: estimate.estimatedCostUsdMax,
  })
  if (opts.scope.dependencySecurityCheck) {
    const depSecInput = runPackageAudit(projectPath)
    if (depSecInput) {
      try {
        const r = await runPass({
          projectId: opts.projectId, projectPath,
          systemPrompt: DEPSEC_REVIEW_SYSTEM_PROMPT,
          userMessage: `Package manager: ${depSecInput.packageManager}\n\nAudit output:\n${depSecInput.auditJson.slice(0, 20_000)}\n\npackage.json:\n${depSecInput.packageJson.slice(0, 5_000)}`,
          model: settings.model, phase: 6, defaultCategory: 'depsec',
        })
        r.findings.forEach(saveFinding)
        accumulateCost(r)
      } catch (err) {
        appendLog(projectPath, auditId, { event: 'phase6_error', error: String(err) })
      }
    }
  }

  // ── Phase 6b: env var check ─────────────────────────────────────────────────
  if (opts.scope.envVarCheck && (envRefs.length > 0 || envExampleKeys.length > 0)) {
    try {
      const refList = envRefs.map((r) => `${r.name} in ${r.filePath}:${r.line}`).join('\n')
      const exampleList = envExampleKeys.join('\n')
      const r = await runPass({
        projectId: opts.projectId, projectPath,
        systemPrompt: ENV_VAR_CHECK_SYSTEM_PROMPT,
        userMessage: `.env.example vars:\n${exampleList || '(none)'}\n\nprocess.env references in code:\n${refList || '(none)'}`,
        model: settings.model, phase: 6, defaultCategory: 'env',
      })
      r.findings.forEach(saveFinding)
      accumulateCost(r)
    } catch (err) {
      appendLog(projectPath, auditId, { event: 'phase6_env_error', error: String(err) })
    }
  }

  // ── Phase 6c: stale TODO judgment ────────────────────────────────────────────
  if (opts.scope.staleTodoCheck && todos.length > 0) {
    try {
      const todoList = todos
        .slice(0, 100)
        .map((t) => `${t.filePath}:${t.line}: ${t.text}\nContext:\n${t.context.join('\n')}`)
        .join('\n\n---\n\n')
      const r = await runPass({
        projectId: opts.projectId, projectPath,
        systemPrompt: STALE_TODO_SYSTEM_PROMPT,
        userMessage: `TODOs to evaluate:\n\n${todoList}`,
        model: settings.model, phase: 6, defaultCategory: 'todo',
      })
      r.findings.forEach(saveFinding)
      accumulateCost(r)
    } catch (err) {
      appendLog(projectPath, auditId, { event: 'phase6_todo_error', error: String(err) })
    }
  }

  // ── Phase 7: Synthesis ──────────────────────────────────────────────────────
  sendToAll(IPC_CHANNELS.AUDIT_PROGRESS, {
    auditId, phase: 7, phaseName: 'Synthesis',
    message: 'Deduplicating and generating report…',
    filesProcessedInPhase: 0, totalFilesInPhase: 0,
    totalProcessed: processedFiles, totalFiles: filesToAudit.length,
    findingsAccumulated: allFindings.length,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    estimatedRemainingMs: 0, currentSpendUsd: totalCostUsd,
    estimatedTotalUsd: estimate.estimatedCostUsdMax,
  })

  await finishAudit('completed')
}

// Wraps runAuditAsync to catch unexpected top-level errors and mark the audit failed
// rather than leaving it stuck in 'running' state.
async function runAuditAsyncSafe(
  auditId: AuditId,
  projectPath: string,
  opts: AuditStartOpts,
  settings: Parameters<typeof runAuditAsync>[3],
  auditRules: ReturnType<typeof loadAuditRules>,
): Promise<void> {
  try {
    await runAuditAsync(auditId, projectPath, opts, settings, auditRules)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[auditor] unexpected error in audit ${auditId}:`, err)
    activeAudits.delete(opts.projectId)
    // Try to persist the failure
    try {
      const meta = readMeta(projectPath, auditId)
      if (meta && meta.status === 'running') {
        writeMeta(projectPath, auditId, {
          ...meta, status: 'failed', completedAt: Date.now(), error: msg,
        })
        removePid(projectPath, auditId)
        sendToAll(IPC_CHANNELS.AUDIT_DONE, auditId, 'failed')
      }
    } catch { /* best-effort */ }
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export function cancelAudit(auditId: AuditId, projectId: string): void {
  // If projectId is not provided (cancel triggered by auditId alone),
  // find it by scanning the registry so the entry is always removed.
  if (projectId) {
    activeAudits.delete(projectId)
  } else {
    for (const [pid, aid] of activeAudits) {
      if (aid === auditId) { activeAudits.delete(pid); break }
    }
  }
  resolveAuditCostCap(auditId)
}

// ─── Estimate ─────────────────────────────────────────────────────────────────

export function computeEstimate(opts: AuditStartOpts, model: ModelName, costCeilingUsd: number): AuditEstimate {
  const projectPath = getProjectPath(opts.projectId)
  const { files } = walkProjectFiles(projectPath)
  return estimateAudit(files, opts.scope, model, costCeilingUsd)
}

// ─── Dry run ──────────────────────────────────────────────────────────────────

export function runDryRun(opts: AuditStartOpts, model: ModelName, costCeilingUsd: number): AuditDryRunResult {
  const projectPath = getProjectPath(opts.projectId)
  const { files, skipped } = walkProjectFiles(projectPath)
  const { filesToAudit } = resolveMode(opts.mode, files, projectPath, opts.subsetPaths)
  const estimate = estimateAudit(filesToAudit, opts.scope, model, costCeilingUsd)

  return {
    files: [
      ...filesToAudit.map((f) => ({
        relativePath: f.relativePath,
        category: f.category,
        importance: f.importance,
      })),
      ...skipped.map((s) => ({
        relativePath: s.relativePath,
        category: 'source' as const,
        importance: 'low' as const,
        skipReason: s.reason,
      })),
    ],
    estimate,
    wouldRunPhases: [
      opts.scope.codeReview ? 'Phase 2: Code Review' : null,
      opts.scope.securityScan ? 'Phase 3: Security Scan' : null,
      opts.scope.schemaReview ? 'Phase 4: Schema Review' : null,
      opts.scope.conventionCheck ? 'Phase 5: Convention Check' : null,
      opts.scope.dependencySecurityCheck ? 'Phase 6: Dependency Security' : null,
      opts.scope.envVarCheck ? 'Phase 6b: Env Var Check' : null,
      opts.scope.staleTodoCheck ? 'Phase 6c: Stale TODO Check' : null,
      'Phase 7: Synthesis',
    ].filter(Boolean) as string[],
  }
}
