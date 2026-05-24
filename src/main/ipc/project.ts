import { ipcMain, dialog, BrowserWindow } from 'electron'
import simpleGit from 'simple-git'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { Project, ProjectActivateResult } from '../../shared/types'
import {
  listProjects,
  addProject,
  touchProject,
  detectProjectName,
  removeProject,
} from '../services/project-registry'
import { stopServer } from '../services/dev-server'
import { maybeAutoSuggestSpecs } from './spec'
import { parseGoalsFile } from '../services/cycle/identity'
import { startWatcher, stopWatcher } from '../services/project-watcher'
import {
  registerWindow,
  unregisterWindow,
  isProjectOpen,
} from '../services/window-registry'

async function getBranch(projectPath: string): Promise<string | null> {
  try {
    const git = simpleGit(projectPath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return null
    const branch = await git.revparse(['--abbrev-ref', 'HEAD'])
    return branch.trim()
  } catch {
    return null
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_LIST, (): Project[] => {
    return listProjects()
  })

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_OPEN_DIALOG,
    async (): Promise<Project | null> => {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win ?? new BrowserWindow(), {
        title: 'Open Project Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Open Project',
      })

      if (result.canceled || result.filePaths.length === 0) return null

      const projectPath = result.filePaths[0]
      const name = detectProjectName(projectPath)

      const project: Project = {
        id: crypto.randomUUID(),
        name,
        path: projectPath,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
      }

      addProject(project)
      return project
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_ACTIVATE,
    async (event, id: string): Promise<ProjectActivateResult | null> => {
      const project = touchProject(id)
      if (!project) return null

      const wcId = event.sender.id

      // Track which project was previously active in this window
      const prevProjectId = registerWindow(wcId, id)

      // Set the OS window title so Mission Control / Exposé shows the project name
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) win.setTitle(project.name)

      // Start watcher for new project (idempotent — won't restart if already watching)
      startWatcher(id, project.path)

      // Stop previous project's watcher only if no other window still has it open
      if (prevProjectId && prevProjectId !== id && !isProjectOpen(prevProjectId)) {
        stopWatcher(prevProjectId)
      }

      const [branch, goals] = await Promise.all([
        getBranch(project.path),
        Promise.resolve(parseGoalsFile(project.path)),
      ])

      maybeAutoSuggestSpecs(id, project.path)
      return { project, branch, goals }
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE, (_e, id: string): void => {
    try { stopServer(id) } catch { /* already stopped */ }
    try { stopWatcher(id) } catch { /* already stopped */ }
    removeProject(id)
  })
}

// Called from index.ts when a BrowserWindow closes — cleans up registry + watcher.
export function handleWindowClosed(webContentsId: number): void {
  const projectId = unregisterWindow(webContentsId)
  if (projectId && !isProjectOpen(projectId)) {
    stopWatcher(projectId)
  }
}
