import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import * as secretsStore from '../services/secrets-store'

export function registerSecretsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SECRETS_LIST, (_e, projectId: string) =>
    secretsStore.listSecretNames(projectId)
  )

  ipcMain.handle(IPC_CHANNELS.SECRETS_REVEAL, (_e, projectId: string, name: string) =>
    secretsStore.getSecret(projectId, name)
  )

  ipcMain.handle(IPC_CHANNELS.SECRETS_SET, (_e, projectId: string, name: string, value: string) =>
    secretsStore.setSecret(projectId, name, value)
  )

  ipcMain.handle(IPC_CHANNELS.SECRETS_DELETE, (_e, projectId: string, name: string) =>
    secretsStore.deleteSecret(projectId, name)
  )

  ipcMain.handle(
    IPC_CHANNELS.SECRETS_IMPORT_ENV,
    async (_e, projectId: string, envContent: string) => {
      const imported: string[] = []
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx < 1) continue
        const name = trimmed.slice(0, eqIdx).trim()
        let value = trimmed.slice(eqIdx + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (name) {
          await secretsStore.setSecret(projectId, name, value)
          imported.push(name)
        }
      }
      return imported
    }
  )

  ipcMain.handle(IPC_CHANNELS.SECRETS_EXPORT_ENV, async (_e, projectId: string) => {
    const names = await secretsStore.listSecretNames(projectId)
    const lines = await Promise.all(
      names.map(async (name) => {
        const value = await secretsStore.getSecret(projectId, name)
        return `${name}=${value ?? ''}`
      })
    )
    return lines.join('\n')
  })
}
