import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Notification } from 'electron'
import Store from 'electron-store'
import { listProjects } from '../project-registry'
import { getActiveChatProjectIds } from '../agent-session'
import { pushAgentEvent } from '../../ipc/agent'
import type { CycleResult, DaemonStatus } from '../../../shared/types'
import { runCycle } from './cycle'
import { pickNextProject, getDaemonEnabled, getProjectConfig, setProjectConfig, recordCycleOutcome } from './scheduler'

const store = new Store()

const POLL_INTERVAL_MS = 30_000

let pollTimer: ReturnType<typeof setInterval> | null = null

type ActiveCyclePhase = 'planning' | 'building' | 'verifying' | 'reflecting' | 'committing'

let activeCycle: {
  projectId: string
  startedAt: number
  cycleId: string
  phase: ActiveCyclePhase
} | null = null

export function startDaemon(): void {
  const experimental = store.get('daemon.experimental', false) as boolean
  const enabled = store.get('daemon.enabled', false) as boolean

  if (!experimental || !enabled) {
    console.log('[daemon] startDaemon called but experimental or enabled flag is false — no-op')
    return
  }

  if (pollTimer) return

  pollTimer = setInterval(() => { maybeCycle().catch((e) => console.error('[daemon] poll error', e)) }, POLL_INTERVAL_MS)
  console.log('[daemon] polling started')
}

export function stopDaemon(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  console.log('[daemon] polling stopped')
}

export async function runCycleNow(
  projectId: string,
  options: { dryRun?: boolean } = {}
): Promise<CycleResult> {
  if (activeCycle) {
    return {
      cycleId: 'rejected',
      projectId,
      outcome: 'failed',
      durationMs: 0,
      error: `Another cycle is already running on project ${activeCycle.projectId}`,
    }
  }

  const projects = listProjects()
  const project = projects.find(p => p.id === projectId)
  if (!project) {
    return {
      cycleId: 'rejected',
      projectId,
      outcome: 'failed',
      durationMs: 0,
      error: `Project ${projectId} not found in registry`,
    }
  }

  activeCycle = {
    projectId,
    startedAt: Date.now(),
    cycleId: 'pending',
    phase: 'planning',
  }

  try {
    const result = await runCycle(project.path, projectId, options)
    activeCycle = null
    if (!options.dryRun) {
      recordCycleOutcome(projectId, result.outcome)
      appendHistory(result)
    }
    return result
  } catch (err) {
    activeCycle = null
    const error = err instanceof Error ? err.message : String(err)
    if (!options.dryRun) recordCycleOutcome(projectId, 'failed')

    const projectName = project.name
    pushAgentEvent({
      type: 'error',
      message: `Daemon cycle on ${projectName} failed: ${error}`,
      source: 'daemon',
    })
    try {
      new Notification({
        title: 'Sneebly: Daemon cycle failed',
        body: `${projectName}: ${error}`,
      }).show()
    } catch { /* notifications are optional */ }

    return { cycleId: 'error', projectId, outcome: 'failed', durationMs: 0, error }
  }
}

export function getDaemonStatus(): DaemonStatus {
  const allProjects = listProjects()
  let totalQueueLength = 0
  let lastCycleAt: number | null = null
  let lastCycleOutcome: string | null = null
  const enabledProjectIds: string[] = []

  for (const p of allProjects) {
    const config = getProjectConfig(p.id)
    if (config.enabled) enabledProjectIds.push(p.id)
    if (config.lastCycleAt && (!lastCycleAt || config.lastCycleAt > lastCycleAt)) {
      lastCycleAt = config.lastCycleAt
      lastCycleOutcome = config.lastCycleOutcome
    }
    const queueDir = join(p.path, '.sneebly', 'queue')
    if (existsSync(queueDir)) {
      try { totalQueueLength += readdirSync(queueDir).filter(f => f.endsWith('.plan.json')).length } catch { /* ignore */ }
    }
  }

  return {
    running: pollTimer !== null,
    activeCycle: activeCycle ? {
      projectId: activeCycle.projectId,
      startedAt: activeCycle.startedAt,
      cycleId: activeCycle.cycleId,
      phase: activeCycle.phase,
    } : null,
    queueLength: totalQueueLength,
    lastCycleAt,
    lastCycleOutcome,
    enabledProjectIds,
  }
}

async function maybeCycle(): Promise<void> {
  if (activeCycle) return

  const projects = listProjects()
  const chatActive = getActiveChatProjectIds()
  const next = pickNextProject(projects, chatActive)

  if (!next) return

  console.log(`[daemon] scheduling cycle for project ${next.id}`)
  await runCycleNow(next.id)
}

function appendHistory(result: CycleResult): void {
  const history = store.get('daemon.history', []) as CycleResult[]
  history.push(result)
  store.set('daemon.history', history.slice(-50))
}
