import { ipcMain, app, dialog } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { AppSettings } from '../../shared/types'

const store = new Store()

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultModel: 'claude-sonnet-4-6',
  defaultProjectsFolder: join(homedir(), 'SneeblyProjects'),
  mcpServers: [],
  recordEventStream: true,
  runNightlyReflections: true,
  autoSelfReview: true,
  autoSelfReviewThresholdFiles: 3,
  autoSelfReviewThresholdLines: 100,
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion())

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): AppSettings => {
    const saved = store.get('appSettings', {}) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...saved }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => {
    const current = store.get('appSettings', DEFAULT_SETTINGS) as AppSettings
    store.set('appSettings', { ...current, ...patch })
  })

  ipcMain.handle(IPC_CHANNELS.ONBOARDING_IS_DONE, (): boolean => {
    return store.get('onboarding.completed', false) as boolean
  })

  ipcMain.handle(IPC_CHANNELS.ONBOARDING_COMPLETE, () => {
    store.set('onboarding.completed', true)
  })
}
