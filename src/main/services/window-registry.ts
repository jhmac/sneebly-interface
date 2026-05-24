import { webContents } from 'electron'

// Maps webContentsId → projectId for routing push events to the right window.
// A window is registered when PROJECT_ACTIVATE is called and unregistered on window close.
const registry = new Map<number, string>()

export function registerWindow(webContentsId: number, projectId: string): string | undefined {
  const prev = registry.get(webContentsId)
  registry.set(webContentsId, projectId)
  return prev
}

export function unregisterWindow(webContentsId: number): string | undefined {
  const projectId = registry.get(webContentsId)
  registry.delete(webContentsId)
  return projectId
}

export function getProjectForWindow(webContentsId: number): string | undefined {
  return registry.get(webContentsId)
}

export function isProjectOpen(projectId: string): boolean {
  for (const pid of registry.values()) {
    if (pid === projectId) return true
  }
  return false
}

// Send to all windows that have the given project active.
export function sendToProjectWindows(projectId: string, channel: string, ...args: unknown[]): void {
  for (const [wcId, pid] of registry) {
    if (pid === projectId) {
      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) wc.send(channel, ...args)
    }
  }
}

// Send to all registered windows (for events that are not project-specific).
export function broadcastToAllWindows(channel: string, ...args: unknown[]): void {
  for (const [wcId] of registry) {
    const wc = webContents.fromId(wcId)
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args)
  }
}
