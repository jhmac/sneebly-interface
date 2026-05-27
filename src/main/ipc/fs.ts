import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, openSync, readSync, closeSync } from 'fs'
import { join, relative, resolve, sep, dirname } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { TreeNode, FileViewerData, SaveArtifactOpts } from '../../shared/types'

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'out', '.next', 'build',
  '.sneebly-interface', '.sneebly', '.DS_Store', 'coverage', '.turbo', '__pycache__',
])

function walkTree(dir: string, base: string): TreeNode[] {
  let entries: import('fs').Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    const rel = relative(base, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, path: rel, kind: 'dir', children: walkTree(full, base) })
    } else if (entry.isFile()) {
      try {
        const s = statSync(full)
        files.push({ name: entry.name, path: rel, kind: 'file', size: s.size, mtime: s.mtimeMs })
      } catch {
        files.push({ name: entry.name, path: rel, kind: 'file' })
      }
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
}

function walk(dir: string, base: string, results: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    try {
      const s = statSync(full)
      if (s.isDirectory()) walk(full, base, results)
      else results.push(relative(base, full))
    } catch { /* skip unreadable */ }
  }
}

export function registerFsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FS_LIST_PROJECT_FILES, (_e, projectPath: string) => {
    const results: string[] = []
    walk(projectPath, projectPath, results)
    return results
  })

  ipcMain.handle(
    IPC_CHANNELS.FS_SAVE_ATTACHMENT,
    (_e, projectPath: string, fileName: string, data: Uint8Array): string => {
      const dir = join(projectPath, '.sneebly-interface', 'attachments')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const filePath = join(dir, fileName)
      writeFileSync(filePath, Buffer.from(data))
      return filePath
    }
  )

  ipcMain.handle(IPC_CHANNELS.FS_SHOW_OPEN_DIALOG, async (): Promise<string[]> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow(), {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC_CHANNELS.FS_GET_TREE, (_e, projectPath: string): TreeNode[] => {
    return walkTree(projectPath, projectPath)
  })

  ipcMain.handle(
    IPC_CHANNELS.FS_READ_FILE,
    (_e, projectPath: string, relativePath: string): FileViewerData => {
      const base = resolve(projectPath)
      const resolved = resolve(join(projectPath, relativePath))
      if (!resolved.startsWith(base + sep) && resolved !== base) {
        throw new Error('Path escape detected')
      }
      const stat = statSync(resolved)
      const sizeBytes = stat.size
      const mtime = stat.mtimeMs
      if (sizeBytes === 0) {
        return { content: '', sizeBytes, mtime, isBinary: false }
      }
      const MAX_READ = 1024 * 1024
      const readSize = Math.min(MAX_READ, sizeBytes)
      const buf = Buffer.alloc(readSize)
      const fd = openSync(resolved, 'r')
      try {
        readSync(fd, buf, 0, readSize, 0)
      } finally {
        closeSync(fd)
      }
      const checkEnd = Math.min(8192, buf.length)
      for (let i = 0; i < checkEnd; i++) {
        if (buf[i] === 0) return { content: '', sizeBytes, mtime, isBinary: true }
      }
      const truncated = sizeBytes > MAX_READ
      let content = buf.toString('utf-8')
      if (truncated) content += '\n\n[... file truncated — showing first 1MB ...]'
      return { content, sizeBytes, mtime, isBinary: false, truncated }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.FS_WRITE_FILE,
    (_e, projectPath: string, relativePath: string, content: string): { mtime: number } => {
      const base = resolve(projectPath)
      const resolved = resolve(join(projectPath, relativePath))
      if (!resolved.startsWith(base + sep) && resolved !== base) {
        throw new Error('Path escape detected')
      }
      // Block writes into internal/build dirs (defense-in-depth)
      const rel = relative(base, resolved)
      const firstSegment = rel.split(sep)[0]
      const BLOCKED_PREFIXES = new Set(['.git', 'node_modules', 'dist', 'out', '.next', '.sneebly-interface', '.sneebly'])
      if (BLOCKED_PREFIXES.has(firstSegment)) {
        throw new Error(`Writes to ${firstSegment}/ are blocked`)
      }
      const dir = dirname(resolved)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(resolved, content, 'utf-8')
      return { mtime: statSync(resolved).mtimeMs }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CHAT_SAVE_ARTIFACT,
    async (_e, opts: SaveArtifactOpts): Promise<void> => {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win ?? new BrowserWindow(), {
        title: 'Save artifact',
        defaultPath: `artifact.${opts.defaultExt}`,
        filters: [{ name: 'All Files', extensions: ['*'] }],
      })
      if (result.canceled || !result.filePath) return
      writeFileSync(result.filePath, opts.content, 'utf-8')
    }
  )
}
