import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Notification, BrowserWindow } from 'electron'
import simpleGit from 'simple-git'
import { pushAgentEvent } from '../../ipc/agent'
import type { AgentEvent, CycleResult } from '../../../shared/types'
import {
  readIdentityFiles, parseHeartbeat, parseIdentity, verifyChecksums,
  parseSafePaths, parseProtectedPaths,
} from './identity'
import { writeJournal } from './journal'
import { runPlan } from './plan'
import { runBuild } from './build'
import { runVerify } from './verify'
import { runReflect } from './reflect'
import { classifyChanges } from './classify'
import { recordFailedApproach } from './memory'
import { isPathSafe } from './path-safety'

export { CycleResult }

export async function runCycle(
  projectRoot: string,
  projectId: string,
  options: { dryRun?: boolean } = {}
): Promise<CycleResult> {
  const cycleId = randomUUID().slice(0, 8)
  const start = Date.now()

  // Push a synthetic summary event to the activity panel for each milestone
  const logUI = (message: string) => {
    const event: AgentEvent = {
      type: 'assistant',
      source: 'daemon',
      message: { content: [{ type: 'text', text: `[Daemon ${cycleId}] ${message}` }] },
    }
    pushAgentEvent(event)
  }

  // Both log to file (for planner context) and push to UI
  const log = (event: Parameters<typeof writeJournal>[1], data: Record<string, unknown> = {}) => {
    writeJournal(projectRoot, event, cycleId, data)
  }

  // Wrap onEvent so all claude subprocess events from cycle phases are tagged daemon
  const daemonEvent = (e: AgentEvent): void => pushAgentEvent({ ...e, source: 'daemon' })

  const notify = (title: string, body: string) => {
    try { new Notification({ title, body }).show() } catch { /* notifications are optional */ }
  }

  try {
    // 1. Verify identity checksums
    const checksumResult = verifyChecksums(projectRoot)
    if (!checksumResult.ok) {
      log('checksum-mismatch', { tampered: checksumResult.tampered })
      const msg = `Identity file tampered: ${checksumResult.tampered.join(', ')}`
      logUI(`Security alert: ${msg}`)
      notify('Sneebly Security Alert', msg)
      return { cycleId, projectId, outcome: 'failed', durationMs: Date.now() - start, error: 'Checksum mismatch' }
    }

    // 2. Load identity
    const identity = readIdentityFiles(projectRoot)
    const heartbeat = parseHeartbeat(identity.heartbeat)
    const identityConfig = parseIdentity(identity.identity)

    log('cycle-start', { projectRoot })
    logUI('Cycle started — pulling latest…')

    // 3. Git pull
    const git = simpleGit(projectRoot)
    try {
      await git.pull('origin', 'main')
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err)
      log('git-pull-failed', { stderr })
      logUI(`Git pull failed: ${stderr}`)
      return { cycleId, projectId, outcome: 'failed', durationMs: Date.now() - start, error: 'git pull failed' }
    }

    // 4. Record HEAD before changes
    let headBefore = ''
    try { headBefore = (await git.revparse(['HEAD'])).trim() } catch { /* shallow repo fallback */ }

    // 5. Plan phase
    logUI('Planning…')
    const plan = await runPlan(projectRoot, projectId, cycleId, heartbeat, daemonEvent)
    log('plan-complete', { constraint: plan.constraint, phase: plan.phase })
    logUI(`Plan: ${plan.constraint} — ${plan.reason}`)

    if (plan.constraint === 'PHASE_COMPLETE') {
      log('phase-complete', { phase: plan.phase })
      logUI(`Phase complete: ${plan.phase}`)
      return { cycleId, projectId, outcome: 'phase-complete', constraint: plan.constraint, durationMs: Date.now() - start }
    }

    if (plan.constraint === 'BLOCKED') {
      await queueItem(projectRoot, cycleId, plan, null, { type: 'blocked', question: plan.requiresHumanAction ?? plan.reason })
      log('blocked', { reason: plan.reason })
      logUI(`Blocked: ${plan.reason}`)
      return { cycleId, projectId, outcome: 'blocked', constraint: plan.constraint, durationMs: Date.now() - start }
    }

    if (options.dryRun) {
      logUI(`Dry-run complete — plan selected: "${plan.constraint}". No build executed.`)
      return { cycleId, projectId, outcome: 'dry-run', constraint: plan.constraint, durationMs: Date.now() - start }
    }

    // 6. Build phase
    logUI('Building…')
    let buildResult = await runBuild(projectRoot, projectId, plan, undefined, daemonEvent)
    log('build-complete', { status: buildResult.status, filesModified: buildResult.filesModified })

    if (buildResult.status === 'blocked') {
      await rollback(git, headBefore)
      await queueItem(projectRoot, cycleId, plan, null, { type: 'blocked', question: buildResult.blockedReason })
      logUI(`Build blocked: ${buildResult.blockedReason}`)
      return { cycleId, projectId, outcome: 'blocked', constraint: plan.constraint, durationMs: Date.now() - start }
    }

    // 7. Path safety check
    const safePaths = parseSafePaths(identity.agents)
    const protectedPaths = parseProtectedPaths(identity.agents)
    const modifiedFiles = buildResult.filesModified
    const unsafePaths = modifiedFiles.filter(f => !isPathSafe(f, safePaths, protectedPaths, projectRoot))
    if (unsafePaths.length > 0) {
      await rollback(git, headBefore)
      log('security-alert', { unsafePaths })
      const msg = `Attempted to modify protected paths: ${unsafePaths.join(', ')}`
      logUI(`Security alert: ${msg}`)
      notify('Sneebly Security Alert', msg)
      return { cycleId, projectId, outcome: 'failed', durationMs: Date.now() - start, error: `Unsafe paths: ${unsafePaths.join(', ')}` }
    }

    // 8. Verify
    logUI('Verifying…')
    let verifyResult = await runVerify(projectRoot, projectId, plan, modifiedFiles, headBefore, daemonEvent)
    log(verifyResult.passed ? 'verify-complete' : 'verify-fail', verifyResult.passed ? { passed: true } : { passed: false, checks: verifyResult.checks })

    // 9. Reflect on failure, optionally retry
    if (!verifyResult.passed) {
      let diff = ''
      try { diff = await git.diff([headBefore]) } catch { /* empty on error */ }

      logUI('Verification failed — reflecting on failure type…')
      const reflectResult = await runReflect(projectRoot, projectId, plan, verifyResult, diff, heartbeat, daemonEvent)
      log('reflect-complete', { failureType: reflectResult.failureType, reasoning: reflectResult.reasoning })
      logUI(`Reflect: ${reflectResult.failureType} failure — ${reflectResult.reasoning}`)

      if (reflectResult.failureType === 'execution' && heartbeat.executionRetries > 0) {
        await rollback(git, headBefore)
        const retryContext = `Previous attempt failed. Verifier findings:\n${JSON.stringify(verifyResult.checks, null, 2)}\n\nReflection:\n${reflectResult.reasoning}`
        logUI('Retrying build with error context…')
        buildResult = await runBuild(projectRoot, projectId, plan, retryContext, daemonEvent)
        if (buildResult.status === 'complete') {
          verifyResult = await runVerify(projectRoot, projectId, plan, buildResult.filesModified, headBefore, daemonEvent)
        }
      }

      if (!verifyResult.passed) {
        recordFailedApproach(projectRoot, {
          constraint: plan.constraint,
          failureType: reflectResult.failureType,
          reasoning: reflectResult.reasoning,
          cycleId,
        })
        await rollback(git, headBefore)
        await queueItem(projectRoot, cycleId, plan, reflectResult, {
          type: 'verify-failed',
          question: reflectResult.specificQuestion ?? reflectResult.recommendedAction,
        })
        logUI(`Queued for review: ${reflectResult.failureType} failure on "${plan.constraint}"`)
        return { cycleId, projectId, outcome: 'queued', constraint: plan.constraint, durationMs: Date.now() - start }
      }
    }

    // 10. Classify
    const classification = classifyChanges(plan, modifiedFiles, identity.agents)

    if (classification.decision === 'queue-for-approval') {
      let diff = ''
      try { diff = await git.diff([headBefore]) } catch { /* empty on error */ }
      await saveQueuedDiff(projectRoot, cycleId, plan, diff, classification.reason)
      await rollback(git, headBefore)
      log('queued', { reason: classification.reason })
      logUI(`Queued for approval: ${plan.constraint} — ${classification.reason}`)
      notify('Sneebly', `${identityConfig.projectName || projectRoot.split('/').pop()}: queued for approval — ${plan.constraint}`)
      return { cycleId, projectId, outcome: 'queued', constraint: plan.constraint, durationMs: Date.now() - start }
    }

    // 11. Auto-commit
    const commitMsg = `sneebly: ${plan.constraint}\n\n${plan.reason}\n\nSneebly Interface cycle ${cycleId}`
    logUI('Committing…')
    await git.add(['-A'])
    await git.commit(commitMsg)
    await git.push()
    log('committed', { constraint: plan.constraint, cycleId })
    logUI(`Committed: ${plan.constraint}`)
    notify('Sneebly', `${identityConfig.projectName || projectRoot.split('/').pop()}: committed — ${plan.constraint}`)

    // 12. Background deployed health check (fire-and-forget)
    if (identityConfig.productionUrl && identityConfig.healthEndpoint) {
      verifyDeployed(projectRoot, cycleId, identityConfig.productionUrl + identityConfig.healthEndpoint, heartbeat.deployedHealthTimeoutMs, logUI)
    }

    log('cycle-end', { outcome: 'committed' })
    return { cycleId, projectId, outcome: 'committed', constraint: plan.constraint, durationMs: Date.now() - start }

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    writeJournal(projectRoot, 'cycle-end', cycleId, { outcome: 'failed', error })
    logUI(`Cycle failed: ${error}`)
    return { cycleId, projectId, outcome: 'failed', durationMs: Date.now() - start, error }
  }
}

async function rollback(git: ReturnType<typeof simpleGit>, headBefore: string): Promise<void> {
  try {
    if (headBefore) {
      await git.reset(['--hard', headBefore])
    } else {
      await git.checkout(['.'])
    }
    await git.clean('f', ['-d'])
  } catch { /* best-effort rollback */ }
}

async function saveQueuedDiff(
  projectRoot: string,
  cycleId: string,
  plan: Record<string, unknown>,
  diff: string,
  reason: string
): Promise<void> {
  const queueDir = join(projectRoot, '.sneebly', 'queue')
  mkdirSync(queueDir, { recursive: true })
  writeFileSync(join(queueDir, `pending-${cycleId}.diff`), diff)
  writeFileSync(join(queueDir, `pending-${cycleId}.plan.json`), JSON.stringify({ plan, reason, cycleId, ts: new Date().toISOString() }, null, 2))
}

async function queueItem(
  projectRoot: string,
  cycleId: string,
  plan: Record<string, unknown>,
  reflect: Record<string, unknown> | null,
  meta: { type: string; question?: string }
): Promise<void> {
  const queueDir = join(projectRoot, '.sneebly', 'queue')
  mkdirSync(queueDir, { recursive: true })
  writeFileSync(
    join(queueDir, `pending-${cycleId}.plan.json`),
    JSON.stringify({ plan, reflect, meta, cycleId, ts: new Date().toISOString() }, null, 2)
  )
}

function verifyDeployed(projectRoot: string, cycleId: string, url: string, timeoutMs: number, logUI: (msg: string) => void): void {
  const pollInterval = 5000
  const deadline = Date.now() + timeoutMs

  const poll = async () => {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          writeJournal(projectRoot, 'deployed-ok', cycleId, { url })
          logUI(`Deployed health check passed: ${url}`)
          return
        }
      } catch { /* continue polling */ }
      await new Promise(r => setTimeout(r, pollInterval))
    }
    writeJournal(projectRoot, 'deployed-failed', cycleId, { url, reason: 'timeout' })
    logUI(`Deployed health check timed out: ${url}`)
  }

  poll().catch(() => {})
}
