import { ipcMain } from 'electron'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { QueueItem, OpenQuestion, DaemonProjectConfig } from '../../shared/types'
import { listProjects } from '../services/project-registry'
import {
  startDaemon, stopDaemon, runCycleNow, getDaemonStatus,
} from '../services/cycle/daemon-runner'
import { getProjectConfig, setProjectConfig, getDaemonEnabled } from '../services/cycle/scheduler'

const store = new Store()

export function registerDaemonHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DAEMON_STATUS, () => getDaemonStatus())

  ipcMain.handle(IPC_CHANNELS.DAEMON_RUN_NOW, (_e, projectId: string, options?: { dryRun?: boolean }) => {
    return runCycleNow(projectId, options ?? {})
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_START, () => {
    startDaemon()
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_STOP, () => {
    stopDaemon()
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_GET_PROJECT_CONFIG, (_e, projectId: string): DaemonProjectConfig => {
    return getProjectConfig(projectId)
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_SET_PROJECT_CONFIG, (_e, projectId: string, config: Partial<DaemonProjectConfig>) => {
    setProjectConfig(projectId, config)
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_LIST_QUEUE, (_e, projectId: string): QueueItem[] => {
    const project = listProjects().find(p => p.id === projectId)
    if (!project) return []
    const queueDir = join(project.path, '.sneebly', 'queue')
    if (!existsSync(queueDir)) return []

    const items: QueueItem[] = []
    for (const f of readdirSync(queueDir)) {
      if (!f.endsWith('.plan.json')) continue
      try {
        const raw = JSON.parse(readFileSync(join(queueDir, f), 'utf8')) as {
          cycleId: string
          plan: { constraint: string; reason: string }
          meta?: { type: string; question?: string }
          ts: string
        }
        items.push({
          cycleId: raw.cycleId,
          constraint: raw.plan?.constraint ?? 'Unknown',
          reason: raw.plan?.reason ?? '',
          type: (raw.meta?.type ?? 'blocked') as QueueItem['type'],
          question: raw.meta?.question,
          ts: raw.ts,
        })
      } catch { /* skip malformed entries */ }
    }
    return items.sort((a, b) => a.ts.localeCompare(b.ts))
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_QUEUE_APPROVE, async (_e, projectId: string, cycleId: string) => {
    const project = listProjects().find(p => p.id === projectId)
    if (!project) return { success: false, conflicts: 'Project not found' }

    const queueDir = join(project.path, '.sneebly', 'queue')
    const diffPath = join(queueDir, `pending-${cycleId}.diff`)
    const planPath = join(queueDir, `pending-${cycleId}.plan.json`)

    if (!existsSync(diffPath)) return { success: false, conflicts: 'Diff file not found' }

    try {
      const git = simpleGit(project.path)
      await git.applyPatch([diffPath], ['--3way'])
      await git.add(['-A'])
      await git.commit(`sneebly: approve queued cycle ${cycleId}`)
      await git.push()
      rmSync(diffPath, { force: true })
      if (existsSync(planPath)) rmSync(planPath, { force: true })
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, conflicts: msg }
    }
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_QUEUE_REJECT, (_e, projectId: string, cycleId: string) => {
    const project = listProjects().find(p => p.id === projectId)
    if (!project) return
    const queueDir = join(project.path, '.sneebly', 'queue')
    for (const suffix of ['.diff', '.plan.json']) {
      const p = join(queueDir, `pending-${cycleId}${suffix}`)
      if (existsSync(p)) rmSync(p, { force: true })
    }
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_LIST_OPEN_QUESTIONS, (_e, projectId: string): OpenQuestion[] => {
    const project = listProjects().find(p => p.id === projectId)
    if (!project) return []
    const queueDir = join(project.path, '.sneebly', 'queue')
    if (!existsSync(queueDir)) return []

    const questions: OpenQuestion[] = []
    for (const f of readdirSync(queueDir)) {
      if (!f.endsWith('.plan.json')) continue
      try {
        const raw = JSON.parse(readFileSync(join(queueDir, f), 'utf8')) as {
          cycleId: string
          plan: { constraint: string }
          meta?: { type: string; question?: string }
          ts: string
        }
        if (raw.meta?.type === 'blocked' && raw.meta.question) {
          questions.push({
            cycleId: raw.cycleId,
            question: raw.meta.question,
            constraint: raw.plan?.constraint ?? 'Unknown',
            ts: raw.ts,
          })
        }
      } catch { /* skip */ }
    }
    return questions.sort((a, b) => a.ts.localeCompare(b.ts))
  })

  ipcMain.handle(IPC_CHANNELS.DAEMON_ANSWER_OPEN_QUESTION, (_e, projectId: string, cycleId: string, answer: string) => {
    const project = listProjects().find(p => p.id === projectId)
    if (!project) return

    // Append answer to GOALS.md Open Questions section
    const goalsPath = join(project.path, 'GOALS.md')
    if (existsSync(goalsPath)) {
      const content = readFileSync(goalsPath, 'utf8')
      const answerEntry = `\n- **[${new Date().toISOString().slice(0, 10)}]** ${answer}\n`
      const updated = content.includes('## Open Questions')
        ? content.replace('## Open Questions', `## Open Questions\n${answerEntry}`)
        : content + '\n## Open Questions\n' + answerEntry
      require('node:fs').writeFileSync(goalsPath, updated)
    }

    // Remove the blocked queue item
    const queueDir = join(project.path, '.sneebly', 'queue')
    const planPath = join(queueDir, `pending-${cycleId}.plan.json`)
    if (existsSync(planPath)) rmSync(planPath, { force: true })
  })
}
