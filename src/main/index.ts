import { fixMacOsPath } from './services/fix-path'
fixMacOsPath()

import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, appendFileSync, existsSync, cpSync } from 'fs'
import { homedir } from 'os'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { LayoutSizes, PongPayload } from '../shared/types'
import { registerProjectHandlers } from './ipc/project'
import { registerPreviewHandlers } from './ipc/preview'
import { registerChatHandlers } from './ipc/chat'
import { registerAgentHandlers } from './ipc/agent'
import { registerFsHandlers } from './ipc/fs'
import { registerSystemHandlers } from './ipc/system'
import { registerSecretsHandlers } from './ipc/secrets'
import { registerSettingsHandlers } from './ipc/settings'
import { registerDaemonHandlers } from './ipc/daemon'
import { registerGitHubHandlers } from './ipc/github'
import { stopAllServers } from './services/dev-server'
import { stopAllWatchers } from './services/project-watcher'
import { ensureChromiumInstalled } from './services/playwright-setup'
import { generateMcpConfig } from './services/mcp-config'
import { initAutoUpdater } from './services/auto-updater'
import { setupTray, teardownTray } from './services/tray'
import { getDaemonStatus, stopDaemon } from './services/cycle/daemon-runner'

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
}

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let isAppQuitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  mainWindow.on('close', (event) => {
    const showInMenuBar = store.get('daemon.runAfterQuit', false) as boolean
    const daemonRunning = getDaemonStatus().running
    if (showInMenuBar && daemonRunning && !isAppQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    stopAllServers()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers()
  generateMcpConfig()
  ensureChromiumInstalled()
  initAutoUpdater()
  createWindow()
  setupTray()
  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
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
