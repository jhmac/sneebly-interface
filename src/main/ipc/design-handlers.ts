import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { sendToProjectWindows } from '../services/window-registry'
import {
  startDesignGeneration,
  startVariantGeneration,
  cancelDesignGeneration,
} from '../services/design-generator'
import {
  listDesigns,
  loadDesign,
  saveDesign,
  deleteDesign,
  renameDesign,
} from '../services/design-store'
import { formatProjectContext } from '../services/project-context-bundler'
import { getProjectPath } from './design-handler-utils'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const GenerateDesignSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1),
  parentFrameId: z.string().optional(),
  parentFrameCode: z.string().optional(),
  parentFramePrompt: z.string().optional(),
})

const GenerateVariantsSchema = GenerateDesignSchema.extend({
  count: z.number().int().min(1).max(8),
})

const CancelDesignSchema = z.object({
  generationId: z.string().min(1),
})

const ProjectIdSchema = z.object({ projectId: z.string().min(1) })

const DesignNameSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
})

const FrameSchema = z.object({
  id: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  code: z.string(),
  kind: z.enum(['html', 'react', 'svg', 'mermaid']),
  prompt: z.string(),
  parentFrameId: z.string().optional(),
  generatedAt: z.number(),
})

const SaveDesignSchema = z.object({
  projectId: z.string().min(1),
  design: z.object({
    name: z.string().min(1),
    createdAt: z.number(),
    updatedAt: z.number(),
    frames: z.array(FrameSchema),
  }),
})

const RenameDesignSchema = z.object({
  projectId: z.string().min(1),
  oldName: z.string().min(1),
  newName: z.string().min(1),
})

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerDesignHandlers(): void {
  // ── design:generate — single generation ──────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_GENERATE, (_e, raw: unknown) => {
    const opts = GenerateDesignSchema.parse(raw)
    const projectPath = getProjectPath(opts.projectId)

    const projectContext = formatProjectContext(projectPath)
    const generationId = startDesignGeneration(
      {
        projectId: opts.projectId,
        projectPath,
        prompt: opts.prompt,
        parentFrameCode: opts.parentFrameCode,
        parentFramePrompt: opts.parentFramePrompt,
        projectContext: projectContext || undefined,
      },
      {
        onResult: (r) =>
          sendToProjectWindows(
            opts.projectId,
            IPC_CHANNELS.DESIGN_VARIANT_RESULT,
            r.generationId,
            r.code,
            r.kind,
          ),
        onError: (gid, err) =>
          sendToProjectWindows(opts.projectId, IPC_CHANNELS.DESIGN_GENERATION_ERROR, gid, err),
      },
    )

    return { generationId }
  })

  // ── design:generate-variants — N parallel generations ────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_GENERATE_VARIANTS, (_e, raw: unknown) => {
    const opts = GenerateVariantsSchema.parse(raw)
    const projectPath = getProjectPath(opts.projectId)
    const projectContext = formatProjectContext(projectPath)

    const generationIds = startVariantGeneration(
      {
        projectId: opts.projectId,
        projectPath,
        prompt: opts.prompt,
        count: opts.count,
        projectContext: projectContext || undefined,
      },
      {
        onResult: (r) =>
          sendToProjectWindows(
            opts.projectId,
            IPC_CHANNELS.DESIGN_VARIANT_RESULT,
            r.generationId,
            r.code,
            r.kind,
          ),
        onError: (gid, err) =>
          sendToProjectWindows(opts.projectId, IPC_CHANNELS.DESIGN_GENERATION_ERROR, gid, err),
      },
    )

    return { generationIds }
  })

  // ── design:iterate-frame — single generation with parent context ──────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_ITERATE_FRAME, (_e, raw: unknown) => {
    const opts = GenerateDesignSchema.parse(raw)
    const projectPath = getProjectPath(opts.projectId)
    const projectContext = formatProjectContext(projectPath)

    const generationId = startDesignGeneration(
      {
        projectId: opts.projectId,
        projectPath,
        prompt: opts.prompt,
        parentFrameCode: opts.parentFrameCode,
        parentFramePrompt: opts.parentFramePrompt,
        projectContext: projectContext || undefined,
      },
      {
        onResult: (r) =>
          sendToProjectWindows(
            opts.projectId,
            IPC_CHANNELS.DESIGN_VARIANT_RESULT,
            r.generationId,
            r.code,
            r.kind,
          ),
        onError: (gid, err) =>
          sendToProjectWindows(opts.projectId, IPC_CHANNELS.DESIGN_GENERATION_ERROR, gid, err),
      },
    )

    return { generationId }
  })

  // ── design:cancel ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_CANCEL, (_e, raw: unknown) => {
    const { generationId } = CancelDesignSchema.parse(raw)
    cancelDesignGeneration(generationId)
  })

  // ── design:list ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_LIST, (_e, raw: unknown) => {
    const { projectId } = ProjectIdSchema.parse(raw)
    return listDesigns(getProjectPath(projectId))
  })

  // ── design:load ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_LOAD, (_e, raw: unknown) => {
    const { projectId, name } = DesignNameSchema.parse(raw)
    return loadDesign(getProjectPath(projectId), name)
  })

  // ── design:save ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_SAVE, (_e, raw: unknown) => {
    const { projectId, design } = SaveDesignSchema.parse(raw)
    saveDesign(getProjectPath(projectId), design)
  })

  // ── design:delete ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_DELETE, (_e, raw: unknown) => {
    const { projectId, name } = DesignNameSchema.parse(raw)
    deleteDesign(getProjectPath(projectId), name)
  })

  // ── design:rename ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DESIGN_RENAME, (_e, raw: unknown) => {
    const { projectId, oldName, newName } = RenameDesignSchema.parse(raw)
    renameDesign(getProjectPath(projectId), oldName, newName)
  })
}
