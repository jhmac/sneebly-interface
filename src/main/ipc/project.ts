import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import simpleGit from 'simple-git'
import { join } from 'path'
import { homedir } from 'os'
import { unlinkSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { cp } from 'fs/promises'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { Project, ProjectActivateResult, ProjectUpdateInput, ProjectRemixResult } from '../../shared/types'
import {
  listProjects,
  getProject,
  addProject,
  touchProject,
  updateProject,
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
    // Clean up icon file if it exists
    const iconPath = join(app.getPath('userData'), 'project-icons', `${id}.png`)
    try { unlinkSync(iconPath) } catch { /* no icon to clean up */ }
    removeProject(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_UPDATE,
    async (_e, id: string, input: ProjectUpdateInput): Promise<Project | null> => {
      const iconDir = join(app.getPath('userData'), 'project-icons')
      const iconFilePath = join(iconDir, `${id}.png`)

      const patch: Partial<Project> = {}
      if (input.name !== undefined) patch.name = input.name.trim()
      if (input.description !== undefined) patch.description = input.description.trim()

      if (input.iconDataUrl === null) {
        try { unlinkSync(iconFilePath) } catch { /* no icon file */ }
        patch.iconPath = undefined
      } else if (typeof input.iconDataUrl === 'string' && input.iconDataUrl.startsWith('data:')) {
        mkdirSync(iconDir, { recursive: true })
        const base64 = input.iconDataUrl.replace(/^data:[^;]+;base64,/, '')
        writeFileSync(iconFilePath, Buffer.from(base64, 'base64'))
        patch.iconPath = iconFilePath
      }

      return updateProject(id, patch)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_REMIX,
    async (_e, id: string): Promise<ProjectRemixResult | null> => {
      const source = getProject(id)
      if (!source) return null

      const baseDir = join(homedir(), 'SneeblyProjects')
      mkdirSync(baseDir, { recursive: true })

      const safeName = source.name.replace(/[/\\:*?"<>|]/g, '-')
      const remixBase = `${safeName}-remix`
      let destPath = join(baseDir, remixBase)
      let suffix = 2
      while (existsSync(destPath)) {
        destPath = join(baseDir, `${remixBase}-${suffix}`)
        suffix++
      }

      const EXCLUDED = new Set(['node_modules', '.git', 'dist', 'out', '.next', '.sneebly'])

      await cp(source.path, destPath, {
        recursive: true,
        filter: (src: string) => {
          const rel = src.slice(source.path.length).replace(/^\//, '')
          if (!rel) return true
          const parts = rel.split('/')
          if (EXCLUDED.has(parts[0])) return false
          if (parts[0] === '.sneebly-interface' && parts.length > 1 && parts[1] === 'sessions') return false
          return true
        },
      })

      const newProject: Project = {
        id: crypto.randomUUID(),
        name: remixBase,
        path: destPath,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
      }
      addProject(newProject)
      return { newProject }
    }
  )
}

// Called from index.ts when a BrowserWindow closes — cleans up registry + watcher.
export function handleWindowClosed(webContentsId: number): void {
  const projectId = unregisterWindow(webContentsId)
  if (projectId && !isProjectOpen(projectId)) {
    stopWatcher(projectId)
  }
}
