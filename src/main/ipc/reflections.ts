import { ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { normalize } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listProjects } from '../services/project-registry'
import { listReflections } from '../services/reflector'
import { deleteAllEvents } from '../services/event-stream'

export function registerReflectionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.REFLECTION_LIST, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return []
    return listReflections(project.path)
  })

  ipcMain.handle(IPC_CHANNELS.REFLECTION_READ, (_e, filePath: string) => {
    // Only serve files from a known project's reflections directory
    const norm = normalize(filePath)
    const isKnownReflection =
      norm.endsWith('.md') &&
      norm.includes('.sneebly-interface') &&
      norm.includes('reflections') &&
      listProjects().some((p) => norm.startsWith(normalize(p.path)))
    if (!isKnownReflection) return ''
    try {
      return readFileSync(norm, 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENTS_DELETE_ALL, (_e, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) return
    deleteAllEvents(project.path)
  })
}
