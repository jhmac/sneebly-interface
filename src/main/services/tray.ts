import { Tray, Menu, app } from 'electron'
import { join } from 'path'
import { getMainWindow } from '../index'
import { getDaemonStatus, startDaemon, stopDaemon } from './cycle/daemon-runner'

let tray: Tray | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null

function getIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray-iconTemplate.png')
    : join(__dirname, '../../resources/tray-iconTemplate.png')
}

function rebuildMenu(): void {
  if (!tray) return
  const status = getDaemonStatus()
  const label = !status.running
    ? 'Daemon: Off'
    : status.activeCycle
    ? `Cycling: ${status.activeCycle.projectId.slice(0, 20)}`
    : 'Daemon: Idle'

  const menu = Menu.buildFromTemplate([
    { label: 'Sneebly Interface', enabled: false },
    { label, enabled: false },
    { type: 'separator' },
    {
      label: 'Show window',
      click: () => {
        const win = getMainWindow()
        if (win) {
          win.show()
          win.focus()
        }
      },
    },
    status.running
      ? { label: 'Pause daemon', click: () => { stopDaemon(); rebuildMenu() } }
      : { label: 'Resume daemon', click: () => { startDaemon(); rebuildMenu() } },
    { type: 'separator' },
    { label: 'Quit Sneebly', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(`Sneebly Interface — ${label}`)
}

export function setupTray(): void {
  if (tray) return
  try {
    tray = new Tray(getIconPath())
    rebuildMenu()
    statusInterval = setInterval(rebuildMenu, 5000)
  } catch (err) {
    console.error('[tray] Failed to create tray icon:', err)
  }
}

export function teardownTray(): void {
  if (statusInterval) { clearInterval(statusInterval); statusInterval = null }
  if (tray) { tray.destroy(); tray = null }
}
