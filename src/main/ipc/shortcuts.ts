import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listProjects } from '../services/project-registry'
import {
  loadShortcutsFile,
  refreshShortcuts,
  refreshIfStale,
  pinShortcut,
  unpinShortcut,
} from '../services/shortcut-suggester'
import { appendEvent } from '../services/event-stream'

export function registerShortcutsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SHORTCUTS_LIST, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return { pinned: [], suggested: [], lastRefreshedAt: 0, rejections: [] }
    return refreshIfStale(project.path)
  })

  ipcMain.handle(IPC_CHANNELS.SHORTCUTS_REFRESH, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return { pinned: [], suggested: [], lastRefreshedAt: 0, rejections: [] }
    return refreshShortcuts(project.path)
  })

  ipcMain.handle(IPC_CHANNELS.SHORTCUTS_PIN, (_e, projectId: string, id: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return { pinned: [], suggested: [], lastRefreshedAt: 0, rejections: [] }
    return pinShortcut(project.path, id)
  })

  ipcMain.handle(IPC_CHANNELS.SHORTCUTS_UNPIN, (_e, projectId: string, id: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return { pinned: [], suggested: [], lastRefreshedAt: 0, rejections: [] }

    const before = loadShortcutsFile(project.path)
    const shortcut = before.pinned.find((s) => s.id === id) ?? before.suggested.find((s) => s.id === id)
    const wasPinned = before.pinned.some((s) => s.id === id)

    const result = unpinShortcut(project.path, id)

    if (shortcut) {
      try {
        // '__shortcut__' is a synthetic sessionId for events not tied to a chat session.
        // These accumulate in <project>/.sneebly-interface/events/__shortcut__.jsonl
        appendEvent(project.path, '__shortcut__', {
          id: crypto.randomUUID(),
          sessionId: '__shortcut__',
          projectId,
          ts: Date.now(),
          kind: 'shortcut_rejected',
          source: 'chat',
          payload: { action: shortcut.action, label: shortcut.label, wasPinned },
        })
      } catch (e) {
        console.error('[shortcuts] failed to emit shortcut_rejected:', e)
      }
    }

    return result
  })
}

export function scheduleAllShortcutRefreshes(): void {
  const projects = listProjects()
  for (const project of projects) {
    setTimeout(() => {
      try {
        refreshIfStale(project.path)
      } catch (err) {
        console.error('[shortcuts] refresh failed for', project.id, err)
      }
    }, 15_000)
  }
}
