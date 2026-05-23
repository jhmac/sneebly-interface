import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listProjects } from '../services/project-registry'
import { generateSpecs, listExistingSpecs, specsNeedGeneration } from '../services/spec/spec-generator'
import { parseMilestones } from '../services/spec/milestone-parser'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResearchDepth } from '../services/spec/spec-generator'

// One active generation per project at a time
const activeGenerations = new Set<string>()

function pushSpecProgress(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.SPEC_PROGRESS, event)
  }
}

export function pushSpecAutoSuggest(projectId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.SPEC_AUTO_SUGGEST, projectId)
  }
}

export function registerSpecHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SPEC_GENERATE, async (_e, projectId: string, opts: {
    depth: ResearchDepth
    milestoneIds?: string[]
    overwriteExisting: boolean
  }) => {
    if (activeGenerations.has(projectId)) {
      return { generatedCount: 0, skippedCount: 0, errors: [{ milestoneId: '*', error: 'Generation already in progress for this project.' }] }
    }

    const projects = listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) {
      return { generatedCount: 0, skippedCount: 0, errors: [{ milestoneId: '*', error: 'Project not found.' }] }
    }

    activeGenerations.add(projectId)
    try {
      return await generateSpecs({
        projectPath: project.path,
        projectId,
        depth: opts.depth,
        milestoneIds: opts.milestoneIds,
        overwriteExisting: opts.overwriteExisting,
        onProgress: (event) => pushSpecProgress(event),
      })
    } finally {
      activeGenerations.delete(projectId)
    }
  })

  ipcMain.handle(IPC_CHANNELS.SPEC_LIST, (_e, projectPath: string): string[] => {
    return listExistingSpecs(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.SPEC_LIST_MILESTONES, (_e, projectPath: string) => {
    const goalsPath = join(projectPath, 'GOALS.md')
    if (!existsSync(goalsPath)) return []
    try {
      const content = readFileSync(goalsPath, 'utf-8')
      return parseMilestones(content)
    } catch { return [] }
  })
}

// Called from project:activate to suggest spec generation on new projects
export function maybeAutoSuggestSpecs(projectId: string, projectPath: string): void {
  if (specsNeedGeneration(projectPath)) {
    pushSpecAutoSuggest(projectId)
  }
}
