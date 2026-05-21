import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'

export function registerSystemHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_TAKE_SCREENSHOT,
    (_e, projectPath: string): Promise<string | null> => {
      const dir = join(projectPath, '.sneebly-interface', 'attachments')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const filePath = join(dir, `screenshot-${crypto.randomUUID()}.png`)

      return new Promise((resolve) => {
        const proc = spawn('screencapture', ['-i', filePath])
        proc.on('exit', () => resolve(existsSync(filePath) ? filePath : null))
        proc.on('error', () => resolve(null))
      })
    }
  )
}
