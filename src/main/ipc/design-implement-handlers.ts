import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { sendToProjectWindows } from '../services/window-registry'
import { capturePreview } from '../services/preview-capture'
import { startImplementation, cancelImplementation } from '../services/design-implementer'
import { listProjects } from '../services/project-registry'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CapturePreviewSchema = z.object({
  projectId: z.string().min(1),
  webContentsId: z.number().int().positive(),
})

const ImplementStartSchema = z.object({
  projectId: z.string().min(1),
  frameId: z.string().min(1),
  frameCode: z.string().min(1),
  frameKind: z.enum(['html', 'react', 'svg', 'mermaid']),
  framePrompt: z.string().min(1),
})

const ImplementCancelSchema = z.object({
  implementId: z.string().min(1),
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function getProjectPath(projectId: string): string {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project.path
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerDesignImplementHandlers(): void {
  // ── design:capture-preview ────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_CAPTURE_PREVIEW, async (_e, raw: unknown) => {
    const { projectId, webContentsId } = CapturePreviewSchema.parse(raw)
    const projectPath = getProjectPath(projectId)
    return capturePreview(projectPath, webContentsId)
  })

  // ── design:implement-start ────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_IMPLEMENT_START, (_e, raw: unknown) => {
    const opts = ImplementStartSchema.parse(raw)
    const projectPath = getProjectPath(opts.projectId)

    const implementId = startImplementation(
      {
        projectId: opts.projectId,
        projectPath,
        frameCode: opts.frameCode,
        frameKind: opts.frameKind,
        framePrompt: opts.framePrompt,
      },
      {
        onEvent: (id, event) =>
          sendToProjectWindows(opts.projectId, IPC_CHANNELS.DESIGN_IMPLEMENT_STATUS, {
            implementId: id,
            status: 'running',
            event,
          }),
        onComplete: (id) =>
          sendToProjectWindows(opts.projectId, IPC_CHANNELS.DESIGN_IMPLEMENT_STATUS, {
            implementId: id,
            status: 'success',
          }),
        onError: (id, error) =>
          sendToProjectWindows(opts.projectId, IPC_CHANNELS.DESIGN_IMPLEMENT_STATUS, {
            implementId: id,
            status: 'error',
            error,
          }),
      },
    )

    return { implementId }
  })

  // ── design:implement-cancel ────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_IMPLEMENT_CANCEL, (_e, raw: unknown) => {
    const { implementId } = ImplementCancelSchema.parse(raw)
    cancelImplementation(implementId)
  })
}
