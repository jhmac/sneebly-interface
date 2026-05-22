import { fixMacOsPath } from './services/fix-path'
fixMacOsPath()

import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, appendFileSync } from 'fs'
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
import { stopAllServers } from './services/dev-server'
import { stopAllWatchers } from './services/project-watcher'
import { ensureChromiumInstalled } from './services/playwright-setup'
import { generateMcpConfig } from './services/mcp-config'
import { initAutoUpdater } from './services/auto-updater'

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
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: 'Sneebly Interface',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  })

  mainWindow.on('closed', () => {
    stopAllServers()
    stopAllWatchers()
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAllServers()
  stopAllWatchers()
  if (process.platform !== 'darwin') app.quit()
})
