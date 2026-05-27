import { create } from 'zustand'
import type { ArtifactKind, DesignFile, DesignSummary, SeedFrameState } from '../../shared/types'

// ─── Runtime frame state (renderer-only, not persisted) ───────────────────────

export interface DesignFrameState {
  id: string
  position: { x: number; y: number }
  // When loading is true, code/kind are placeholders (empty)
  code: string
  kind: ArtifactKind
  prompt: string
  parentFrameId?: string
  generatedAt: number
  // Runtime state
  loading: boolean
  error?: string
  generationId?: string
}

export interface DesignState {
  name: string
  createdAt: number
  updatedAt: number
  frames: DesignFrameState[]
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

function newFrameId(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

export const FRAME_WIDTH = 440
export const FRAME_HEIGHT = 460

const FRAME_H_GAP = 20
const FRAME_V_GAP = 40

function nextRow(frames: DesignFrameState[]): { x: number; y: number } {
  if (frames.length === 0) return { x: 0, y: 0 }
  const maxY = Math.max(...frames.map((f) => f.position.y + FRAME_HEIGHT))
  return { x: 0, y: maxY + FRAME_V_GAP }
}

function variantPositions(count: number, startY: number): { x: number; y: number }[] {
  const totalW = count * FRAME_WIDTH + (count - 1) * FRAME_H_GAP
  const startX = -totalW / 2
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * (FRAME_WIDTH + FRAME_H_GAP),
    y: startY,
  }))
}

function iterationPosition(parent: DesignFrameState): { x: number; y: number } {
  return {
    x: parent.position.x + FRAME_WIDTH + FRAME_H_GAP * 2,
    y: parent.position.y,
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface DesignStore {
  currentDesign: DesignState | null
  designs: DesignSummary[]
  /** Renderer-only screenshot seed. Not part of DesignState.frames, never persisted. */
  seedFrame: SeedFrameState | null
  /**
   * True once any frame mutation has occurred since the last load/newDesign.
   * Guards the auto-save effect so loading a design doesn't immediately
   * re-save it (which would corrupt the sorted-by-updatedAt order).
   */
  isDirty: boolean

  // ── Seed frame ───────────────────────────────────────────────────────────
  setSeedFrame: (seed: SeedFrameState) => void
  clearSeedFrame: () => void

  // ── Design list ──────────────────────────────────────────────────────────
  setDesigns: (designs: DesignSummary[]) => void

  // ── Design lifecycle ─────────────────────────────────────────────────────
  newDesign: (name?: string) => void
  loadDesignData: (file: DesignFile) => void
  renameCurrentDesign: (newName: string) => void

  // ── Frame mutations ──────────────────────────────────────────────────────
  /**
   * Add N loading placeholder frames. Each frame needs a generationId so
   * resolveFrame / failFrame can find it later.
   */
  addLoadingFrames: (
    frames: Array<{
      id: string
      generationId: string
      prompt: string
      position: { x: number; y: number }
      parentFrameId?: string
    }>
  ) => void
  /** Called when a generation succeeds. Replaces the loading placeholder. */
  resolveFrame: (generationId: string, code: string, kind: ArtifactKind) => void
  /** Called when a generation fails. Marks the frame with an error. */
  failFrame: (generationId: string, error: string) => void
  /** Remove a frame entirely (cancel placeholder or user delete). */
  removeFrame: (frameId: string) => void
  /** Duplicate a frame to a nearby position. */
  duplicateFrame: (frameId: string) => void
  /** Sync position after a drag-end from react-flow. */
  moveFrame: (frameId: string, position: { x: number; y: number }) => void

  // ── Generation helpers ───────────────────────────────────────────────────
  /**
   * Allocate a frame slot at the bottom of the canvas for a single generation.
   * Returns { frameId, position } to pair with the generationId from IPC.
   */
  prepareGenerate: () => { frameId: string; position: { x: number; y: number } }
  /**
   * Allocate N frame slots in a horizontal row for variant generation.
   * Returns array of { frameId, position } in the same order as generationIds from IPC.
   */
  prepareVariants: (count: number) => Array<{ frameId: string; position: { x: number; y: number } }>
  /**
   * Allocate an iteration frame slot next to the parent.
   * Returns { frameId, position }, or null if the parent frame doesn't exist.
   */
  prepareIterate: (parentFrameId: string) => { frameId: string; position: { x: number; y: number } } | null
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  currentDesign: null,
  designs: [],
  seedFrame: null,
  isDirty: false,

  setSeedFrame: (seed) => set({ seedFrame: seed }),
  clearSeedFrame: () => set({ seedFrame: null }),

  setDesigns: (designs) => set({ designs }),

  newDesign: (name) => {
    const now = Date.now()
    set({
      isDirty: false,
      currentDesign: {
        name: name ?? `Design ${new Date().toISOString().slice(0, 10)}`,
        createdAt: now,
        updatedAt: now,
        frames: [],
      },
    })
  },

  loadDesignData: (file) => {
    set({
      isDirty: false,
      currentDesign: {
        name: file.name,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        frames: file.frames.map((f) => ({
          ...f,
          loading: false,
        })),
      },
    })
  },

  renameCurrentDesign: (newName) =>
    set((s) => ({
      isDirty: true,
      currentDesign: s.currentDesign
        ? { ...s.currentDesign, name: newName, updatedAt: Date.now() }
        : null,
    })),

  addLoadingFrames: (frameDefs) =>
    set((s) => {
      if (!s.currentDesign) return {}
      const now = Date.now()
      const newFrames: DesignFrameState[] = frameDefs.map((fd) => ({
        id: fd.id,
        position: fd.position,
        code: '',
        kind: 'html' as ArtifactKind,
        prompt: fd.prompt,
        parentFrameId: fd.parentFrameId,
        generatedAt: now,
        loading: true,
        generationId: fd.generationId,
      }))
      return {
        isDirty: true,
        currentDesign: {
          ...s.currentDesign,
          frames: [...s.currentDesign.frames, ...newFrames],
          updatedAt: now,
        },
      }
    }),

  resolveFrame: (generationId, code, kind) =>
    set((s) => {
      if (!s.currentDesign) return {}
      const frames = s.currentDesign.frames.map((f) =>
        f.generationId === generationId
          ? { ...f, code, kind, loading: false, generationId: undefined, error: undefined }
          : f
      )
      return { isDirty: true, currentDesign: { ...s.currentDesign, frames, updatedAt: Date.now() } }
    }),

  failFrame: (generationId, error) =>
    set((s) => {
      if (!s.currentDesign) return {}
      const frames = s.currentDesign.frames.map((f) =>
        f.generationId === generationId
          ? { ...f, loading: false, error, generationId: undefined }
          : f
      )
      return { isDirty: true, currentDesign: { ...s.currentDesign, frames, updatedAt: Date.now() } }
    }),

  removeFrame: (frameId) =>
    set((s) => {
      if (!s.currentDesign) return {}
      return {
        isDirty: true,
        currentDesign: {
          ...s.currentDesign,
          frames: s.currentDesign.frames.filter((f) => f.id !== frameId),
          updatedAt: Date.now(),
        },
      }
    }),

  duplicateFrame: (frameId) =>
    set((s) => {
      if (!s.currentDesign) return {}
      const src = s.currentDesign.frames.find((f) => f.id === frameId)
      if (!src) return {}
      const copy: DesignFrameState = {
        ...src,
        id: newFrameId(),
        position: { x: src.position.x + FRAME_WIDTH + FRAME_H_GAP * 2, y: src.position.y },
        generatedAt: Date.now(),
        loading: false,
        generationId: undefined,
        error: undefined,
      }
      return {
        isDirty: true,
        currentDesign: {
          ...s.currentDesign,
          frames: [...s.currentDesign.frames, copy],
          updatedAt: Date.now(),
        },
      }
    }),

  moveFrame: (frameId, position) =>
    set((s) => {
      if (!s.currentDesign) return {}
      const frames = s.currentDesign.frames.map((f) =>
        f.id === frameId ? { ...f, position } : f
      )
      return { isDirty: true, currentDesign: { ...s.currentDesign, frames, updatedAt: Date.now() } }
    }),

  prepareGenerate: () => {
    const { currentDesign, seedFrame } = get()
    const frames = currentDesign?.frames ?? []
    // Place the first generated frame below the seed if no regular frames exist yet
    const position = (frames.length === 0 && seedFrame)
      ? { x: 0, y: FRAME_HEIGHT + FRAME_V_GAP }
      : nextRow(frames)
    return { frameId: newFrameId(), position }
  },

  prepareVariants: (count) => {
    const { currentDesign, seedFrame } = get()
    const frames = currentDesign?.frames ?? []
    // Same seed-awareness for variant rows
    const startY = (frames.length === 0 && seedFrame)
      ? FRAME_HEIGHT + FRAME_V_GAP
      : nextRow(frames).y
    // Use index in the ID so variants generated in the same millisecond are still unique
    return variantPositions(count, startY).map((position, i) => ({
      frameId: `f-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      position,
    }))
  },

  prepareIterate: (parentFrameId) => {
    const parent = get().currentDesign?.frames.find((f) => f.id === parentFrameId)
    if (!parent) return null
    return {
      frameId: newFrameId(),
      position: iterationPosition(parent),
    }
  },
}))
