import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'out', '.next', 'build',
  '.sneebly-interface', '.DS_Store', 'coverage', '.turbo',
])

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
}
