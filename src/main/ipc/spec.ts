import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { sendToProjectWindows } from '../services/window-registry'
import { listProjects } from '../services/project-registry'
import { generateSpecs, listExistingSpecs, specsNeedGeneration, refineSpec } from '../services/spec/spec-generator'
import { parseMilestones } from '../services/spec/milestone-parser'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RefineMode, ResearchDepth } from '../../shared/types'

// One active generation per project at a time
const activeGenerations = new Set<string>()

function pushSpecProgress(event: unknown, projectId: string): void {
  sendToProjectWindows(projectId, IPC_CHANNELS.SPEC_PROGRESS, event)
}

export function pushSpecAutoSuggest(projectId: string): void {
  sendToProjectWindows(projectId, IPC_CHANNELS.SPEC_AUTO_SUGGEST, projectId)
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
        onProgress: (event) => pushSpecProgress(event, projectId),
      })
    } finally {
      activeGenerations.delete(projectId)
    }
  })

  ipcMain.handle(IPC_CHANNELS.SPEC_REFINE, async (_e, projectId: string, opts: {
    milestoneId: string
    refinementPrompt: string
    mode: RefineMode
  }) => {
    if (activeGenerations.has(projectId)) {
      return { success: false, error: 'Another spec operation is already in progress for this project.' }
    }
    const projects = listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return { success: false, error: 'Project not found.' }

    activeGenerations.add(projectId)
    try {
      return await refineSpec({
        projectPath: project.path,
        projectId,
        milestoneId: opts.milestoneId,
        refinementPrompt: opts.refinementPrompt,
        mode: opts.mode,
        onProgress: (event) => pushSpecProgress(event, projectId),
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
