import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listInstalledSkills } from '../services/skills-loader'

export function registerSkillsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, () => listInstalledSkills())
}
