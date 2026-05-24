import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { GrillMessage } from '../../shared/types'
import {
  grillTurn,
  generateGoalsAndPrompt,
  updateStackSection,
  writeGoalsMd,
  writeContextMd,
} from '../services/goals/goals-generator'
import { listProjects } from '../services/project-registry'

export function registerGoalsHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.GOALS_GRILL_TURN,
    async (_event, messages: GrillMessage[], userMessage: string) => {
      return grillTurn(messages, userMessage)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.GOALS_GENERATE,
    async (_event, ideaSeed: string, messages: GrillMessage[]) => {
      return generateGoalsAndPrompt(ideaSeed, messages)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.GOALS_WRITE,
    async (_event, projectId: string, content: string) => {
      const project = listProjects().find((p) => p.id === projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      writeGoalsMd(project.path, content)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.GOALS_WRITE_CONTEXT,
    async (_event, projectId: string, content: string) => {
      const project = listProjects().find((p) => p.id === projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      writeContextMd(project.path, content)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.GOALS_UPDATE_STACK,
    async (_event, goalsMd: string, stackReport: string) => {
      return updateStackSection(goalsMd, stackReport)
    },
  )
}
