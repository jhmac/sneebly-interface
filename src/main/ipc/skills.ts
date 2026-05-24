import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listInstalledSkills } from '../services/skills-loader'
import { seedSkillsIntoProject } from '../services/skills-seeder'
import { listProjects } from '../services/project-registry'

export function registerSkillsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, () => listInstalledSkills())

  ipcMain.handle(IPC_CHANNELS.SKILLS_SEED_INTO_PROJECT, async (_event, projectId: string) => {
    const project = listProjects().find((p) => p.id === projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)
    return seedSkillsIntoProject(project.path)
  })
}
