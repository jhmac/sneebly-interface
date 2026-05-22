import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import { relative } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { FileChangedEvent } from '../../shared/types'

const SKIP_NAMES = new Set([
  'node_modules', '.git', 'dist', 'out', '.next', 'build',
  '.sneebly-interface', '.sneebly', '.DS_Store', 'coverage', '.turbo', '__pycache__',
])

const watchers = new Map<string, chokidar.FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function sendFileChanged(event: FileChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.FS_FILE_CHANGED, event)
  }
}

function debounceEmit(projectId: string, relativePath: string, kind: 'add' | 'change' | 'unlink'): void {
  const key = `${projectId}:${relativePath}`
  const existing = debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    sendFileChanged({ projectId, relativePath, kind })
  }, 300))
}

export function startWatcher(projectId: string, projectPath: string): void {
  stopWatcher(projectId)

  const watcher = chokidar.watch(projectPath, {
    ignored: (filePath: string) => {
      const parts = filePath.replace(/\\/g, '/').split('/')
      return parts.some((p) => SKIP_NAMES.has(p))
    },
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignoreInitial: true,
    persistent: true,
  })

  watcher.on('add', (filePath: string) => {
    const rel = relative(projectPath, filePath).replace(/\\/g, '/')
    debounceEmit(projectId, rel, 'add')
  })
  watcher.on('change', (filePath: string) => {
    const rel = relative(projectPath, filePath).replace(/\\/g, '/')
    debounceEmit(projectId, rel, 'change')
  })
  watcher.on('unlink', (filePath: string) => {
    const rel = relative(projectPath, filePath).replace(/\\/g, '/')
    debounceEmit(projectId, rel, 'unlink')
  })

  watchers.set(projectId, watcher)
}

export function stopWatcher(projectId: string): void {
  const existing = watchers.get(projectId)
  if (existing) {
    existing.close().catch(() => {})
    watchers.delete(projectId)
  }
}

export function stopAllWatchers(): void {
  for (const [id] of watchers) stopWatcher(id)
}
