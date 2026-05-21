import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
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
import { stopAllServers } from './services/dev-server'
import { ensureChromiumInstalled } from './services/playwright-setup'
import { generateMcpConfig } from './services/mcp-config'

const store = new Store()

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
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: 'Sneebly Interface',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  })

  mainWindow.on('closed', () => {
    stopAllServers()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  generateMcpConfig()
  ensureChromiumInstalled()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAllServers()
  if (process.platform !== 'darwin') app.quit()
})
