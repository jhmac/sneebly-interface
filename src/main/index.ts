import { fixMacOsPath } from './services/fix-path'
fixMacOsPath()

import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, appendFileSync, existsSync, cpSync } from 'fs'
import { homedir } from 'os'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { LayoutSizes, PongPayload } from '../shared/types'
import { registerProjectHandlers, handleWindowClosed } from './ipc/project'
import { registerPreviewHandlers } from './ipc/preview'
import { registerChatHandlers } from './ipc/chat'
import { registerAgentHandlers } from './ipc/agent'
import { registerFsHandlers } from './ipc/fs'
import { registerSystemHandlers } from './ipc/system'
import { registerSecretsHandlers } from './ipc/secrets'
import { registerSettingsHandlers } from './ipc/settings'
import { registerDaemonHandlers } from './ipc/daemon'
import { registerGitHubHandlers } from './ipc/github'
import { registerSpecHandlers } from './ipc/spec'
import { registerGoalsHandlers } from './ipc/goals'
import { registerSkillsHandlers } from './ipc/skills'
import { registerReflectionHandlers } from './ipc/reflections'
import { registerUsageHandlers } from './ipc/usage'
import { registerLearningsInboxHandlers } from './ipc/learnings-inbox'
import { listProjects } from './services/project-registry'
import { runReflection, reflectionNeeded, hasEnoughEventsToday } from './services/reflector'
import type { AppSettings } from '../shared/types'
import { stopAllServers } from './services/dev-server'
import { stopAllWatchers } from './services/project-watcher'
import { ensureChromiumInstalled } from './services/playwright-setup'
import { generateMcpConfig } from './services/mcp-config'
import { initAutoUpdater } from './services/auto-updater'
import { setupTray, teardownTray } from './services/tray'
import { getDaemonStatus, stopDaemon } from './services/cycle/daemon-runner'
import { scheduleConventionExtraction } from './services/convention-extractor'
import { registerShortcutsHandlers, scheduleAllShortcutRefreshes } from './ipc/shortcuts'

// ── User data migration (sneebly-interface → Sneebly) ─────────────────────────
function migrateUserData(): void {
  const home = homedir()
  const oldPath = join(home, 'Library', 'Application Support', 'sneebly-interface')
  const newPath = join(home, 'Library', 'Application Support', 'Sneebly')
  if (existsSync(oldPath) && !existsSync(newPath)) {
    try {
      mkdirSync(newPath, { recursive: true })
      cpSync(oldPath, newPath, { recursive: true })
      console.log(`[Sneebly] Migrated user data from ${oldPath} to ${newPath}`)
    } catch (err) {
      console.error('[Sneebly] User data migration failed:', err)
    }
  }
}
migrateUserData()

const store = new Store()

// ── Crash log writer ───────────────────────────────────────────────────────
const CRASH_LOG = join(homedir(), 'Library', 'Logs', 'SneeblyInterface', 'crash.log')

function writeCrashLog(err: unknown): void {
  try {
    mkdirSync(dirname(CRASH_LOG), { recursive: true })
    const entry = `\n[${new Date().toISOString()}]\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
    appendFileSync(CRASH_LOG, entry, 'utf-8')
  } catch {
    // Swallow — we don't want the crash handler to crash
  }
}

process.on('uncaughtException', (err) => {
  writeCrashLog(err)
  console.error('[Sneebly] Uncaught exception:', err)
})

process.on('unhandledRejection', (reason) => {
  writeCrashLog(reason)
  console.error('[Sneebly] Unhandled rejection:', reason)
})

// ── IPC ───────────────────────────────────────────────────────────────────
function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PING, (): PongPayload => ({
    message: 'pong',
    timestamp: Date.now(),
  }))

  ipcMain.handle(IPC_CHANNELS.LAYOUT_GET_SIZES, () => {
    return (store.get('layout.workspace.sizes', null) as LayoutSizes | null)
  })

  ipcMain.handle(IPC_CHANNELS.LAYOUT_SET_SIZES, (_event, sizes: LayoutSizes) => {
    store.set('layout.workspace.sizes', sizes)
  })

  registerProjectHandlers()
  registerPreviewHandlers()
  registerChatHandlers()
  registerAgentHandlers()
  registerFsHandlers()
  registerSystemHandlers()
  registerSecretsHandlers()
  registerSettingsHandlers()
  registerDaemonHandlers()
  registerGitHubHandlers()
  registerSpecHandlers()
  registerGoalsHandlers()
  registerSkillsHandlers()
  registerReflectionHandlers()
  registerUsageHandlers()
  registerLearningsInboxHandlers()
  registerShortcutsHandlers()

  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_PROJECT, (_event, projectId: string) => {
    createProjectWindow(projectId)
  })
}

// ── Window ─────────────────────────────────────────────────────────────────
let isAppQuitting = false

function createProjectWindow(initialProjectId?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: 'Sneebly',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  })

  win.on('close', (event) => {
    const showInMenuBar = store.get('daemon.runAfterQuit', false) as boolean
    const daemonRunning = getDaemonStatus().running
    if (showInMenuBar && daemonRunning && !isAppQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    handleWindowClosed(win.webContents.id)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (initialProjectId) url.searchParams.set('projectId', initialProjectId)
    win.loadURL(url.toString())
  } else {
    win.loadFile(
      join(__dirname, '../renderer/index.html'),
      initialProjectId ? { query: { projectId: initialProjectId } } : {}
    )
  }

  return win
}

// ── App lifecycle ──────────────────────────────────────────────────────────
function scheduleReflections(): void {
  const settings = store.get('appSettings', {}) as Partial<AppSettings>
  if (settings.runNightlyReflections === false) return
  if (settings.recordEventStream === false) return

  const projects = listProjects()
  const queue = projects.filter(
    (p) => reflectionNeeded(p.path) && hasEnoughEventsToday(p.path)
  )

  if (queue.length === 0) return

  const generateLearningProposals = (settings.generateLearningProposals as boolean | undefined) !== false
  const runShadowSessions = (settings.runShadowSessions as boolean | undefined) === true

  async function runNext(idx: number): Promise<void> {
    if (idx >= queue.length) return
    const project = queue[idx]!
    try {
      await runReflection(project.path, project.id, new Date(), { generateLearningProposals, runShadowSessions })
    } catch (err) {
      console.error(`[Sneebly] Reflection failed for ${project.id}:`, err)
    }
    await runNext(idx + 1)
  }

  // Off the critical path — don't block app startup
  setTimeout(() => {
    runNext(0).catch((err: unknown) => console.error('[Sneebly] Reflection queue error:', err))
  }, 5000)
}

function scheduleAllConventionExtractions(): void {
  const settings = store.get('appSettings', {}) as Partial<AppSettings>
  if (settings.recordEventStream === false) return
  const projects = listProjects()
  for (const project of projects) {
    scheduleConventionExtraction(project.path, project.id)
  }
}

app.whenReady().then(() => {
  // Set dock icon in dev mode (packaged builds pick it up from the bundle automatically)
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
  }

  registerIpcHandlers()
  generateMcpConfig()
  ensureChromiumInstalled()
  initAutoUpdater()
  createProjectWindow()
  setupTray()
  scheduleReflections()
  scheduleAllConventionExtractions()
  scheduleAllShortcutRefreshes()
  app.on('activate', () => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    if (wins.length > 0) {
      const win = BrowserWindow.getFocusedWindow() ?? wins[0]
      win.show()
      win.focus()
    } else {
      createProjectWindow()
    }
  })
})

app.on('before-quit', () => {
  isAppQuitting = true
})

app.on('will-quit', (event) => {
  const status = getDaemonStatus()
  if (status.activeCycle) {
    // Attempt graceful stop — give cycle up to 3s then proceed
    event.preventDefault()
    stopDaemon()
    setTimeout(() => app.quit(), 3000)
    return
  }
  stopDaemon()
  stopAllWatchers()
  teardownTray()
})

app.on('window-all-closed', () => {
  const showInMenuBar = store.get('daemon.runAfterQuit', false) as boolean
  const daemonRunning = getDaemonStatus().running
  // On macOS, if the daemon is running and "show in menu bar" is on, keep alive
  if (process.platform === 'darwin' && showInMenuBar && daemonRunning) return
  stopAllServers()
  if (process.platform !== 'darwin') app.quit()
})
