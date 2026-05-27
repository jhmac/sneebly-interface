import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Plus, Save, ChevronDown, Loader2, Check } from 'lucide-react'
import DesignCanvas from '../panels/DesignCanvas/DesignCanvas'
import ImplementConfirmModal from '../panels/DesignCanvas/ImplementConfirmModal'
import ImplementProgressPanel from '../panels/DesignCanvas/ImplementProgressPanel'
import { useDesignStore } from '../state/designStore'
import { usePreviewStore } from '../state/previewStore'
import { useProjectStore } from '../state/projectStore'
import { useDesignImplementStore } from '../state/designImplementStore'
import { useViewStore } from '../state/viewStore'
import { SEED_FRAME_ID } from '../panels/DesignCanvas/SeedFrame'
import type { DesignFile } from '../../shared/types'
import type { DesignState } from '../state/designStore'

interface Props {
  projectId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert runtime design state to the persisted DesignFile shape.
 *  Only includes frames that have finished generating (no placeholders / errors). */
function toDesignFile(design: DesignState): DesignFile {
  return {
    name: design.name,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    frames: design.frames
      .filter((f) => !f.loading && !f.error && f.code)
      .map((f) => ({
        id: f.id,
        position: f.position,
        code: f.code,
        kind: f.kind,
        prompt: f.prompt,
        parentFrameId: f.parentFrameId,
        generatedAt: f.generatedAt,
      })),
  }
}

// ─── DesignView ───────────────────────────────────────────────────────────────

export default function DesignView({ projectId }: Props) {
  const {
    currentDesign,
    seedFrame,
    designs,
    isDirty,
    setDesigns,
    newDesign,
    loadDesignData,
    renameCurrentDesign,
    addLoadingFrames,
    setSeedFrame,
    prepareGenerate,
    prepareVariants,
    prepareIterate,
  } = useDesignStore()

  const { status: previewStatus, webContentsId } = usePreviewStore()
  const { projects } = useProjectStore()
  const { current: implementState, startPending, reset: resetImplement } = useDesignImplementStore()
  const { setView } = useViewStore()

  const [prompt, setPrompt] = useState('')
  const [variantMode, setVariantMode] = useState(false)
  const [variantCount, setVariantCount] = useState(4)
  const [iteratingFrameId, setIteratingFrameId] = useState<string | null>(null)
  const [iteratePrompt, setIteratePrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const implementErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const capturingRef = useRef(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [loadMenuOpen, setLoadMenuOpen] = useState(false)

  // frameId being confirmed for implementation (null = no modal)
  const [confirmingFrameId, setConfirmingFrameId] = useState<string | null>(null)
  const [implementStartError, setImplementStartError] = useState<string | null>(null)

  const activeProject = projects.find((p) => p.id === projectId) ?? null

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  // Runs only when projectId changes (not on Design-tab open/close for the same
  // project — Zustand preserves canvas state across tab navigation).
  // Auto-loads the most recently saved design so the user never lands on a blank
  // canvas after having done work. Falls back to newDesign() when nothing is saved
  // or the load fails.

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const list = await window.api.designList(projectId).catch(() => [])
      if (cancelled) return
      setDesigns(list)

      if (list.length > 0) {
        // list is already sorted newest-first by updatedAt (from design-store.ts)
        const file = await window.api.designLoad(projectId, list[0].name).catch(() => null)
        if (cancelled) return
        if (file) {
          loadDesignData(file)
          return
        }
      }

      // No saved designs or load failed — ensure we have a working canvas.
      // (App.tsx calls newDesign() on project switch, but this guards against
      // cases where DesignView mounts without that path running.)
      if (!useDesignStore.getState().currentDesign) newDesign()
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // ── Seed from current preview ──────────────────────────────────────────────
  // Fires whenever previewStatus or webContentsId changes (and on mount).
  // Captures once the canvas is empty and a live preview is available —
  // handles the race where the dev server was still starting when Design tab opened.

  useEffect(() => {
    const hasFrames = (currentDesign?.frames.length ?? 0) > 0
    if (hasFrames || seedFrame) return                          // already have content
    if (previewStatus !== 'running' || !webContentsId) return  // no live preview
    if (capturingRef.current) return                           // prevent concurrent captures

    capturingRef.current = true
    window.api.designCapturePreview({ projectId, webContentsId })
      .then((result) => {
        if (result) {
          setSeedFrame({ dataUrl: result.dataUrl, capturedAt: Date.now() })
        }
      })
      .catch(console.error)
      .finally(() => { capturingRef.current = false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewStatus, webContentsId])

  // ── Auto-save (debounced 500ms after any change) ───────────────────────────
  // Gated on isDirty so loading a design doesn't immediately re-save it
  // (which would update updatedAt and corrupt the newest-first sort order).

  useEffect(() => {
    if (!currentDesign || !isDirty) return
    const file = toDesignFile(currentDesign)
    if (file.frames.length === 0) return

    const timer = setTimeout(() => {
      window.api.designSave(projectId, file)
        .then(() => window.api.designList(projectId))
        .then(setDesigns)
        .catch(console.error)
    }, 500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDesign, isDirty])

  // ── Manual save ───────────────────────────────────────────────────────────

  function handleManualSave() {
    if (!currentDesign) return
    const file = toDesignFile({ ...currentDesign, updatedAt: Date.now() })
    void window.api.designSave(projectId, file)
      .then(() => window.api.designList(projectId))
      .then(setDesigns)
      .then(() => {
        if (savedTimer.current) clearTimeout(savedTimer.current)
        setSaved(true)
        savedTimer.current = setTimeout(() => setSaved(false), 1500)
      })
      .catch(console.error)
  }

  // ── Cmd+S ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleManualSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDesign])

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    if (implementErrorTimerRef.current) clearTimeout(implementErrorTimerRef.current)
  }, [])

  // ── Load design ───────────────────────────────────────────────────────────

  async function handleLoadDesign(name: string) {
    setLoadMenuOpen(false)
    const file = await window.api.designLoad(projectId, name).catch(() => null)
    if (file) loadDesignData(file)
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  async function handleGenerate() {
    const p = prompt.trim()
    if (!p || generating) return
    setGenerating(true)
    setPrompt('')

    try {
      if (variantMode) {
        const slots = prepareVariants(variantCount)
        const { generationIds } = await window.api.designGenerateVariants({
          projectId,
          prompt: p,
          count: variantCount,
        })
        addLoadingFrames(
          slots.map((slot, i) => ({
            id: slot.frameId,
            generationId: generationIds[i] ?? `gen-${i}`,
            prompt: p,
            position: slot.position,
          }))
        )
      } else {
        const slot = prepareGenerate()
        const { generationId } = await window.api.designGenerate({ projectId, prompt: p })
        addLoadingFrames([{
          id: slot.frameId,
          generationId,
          prompt: p,
          position: slot.position,
        }])
      }
    } catch (err) {
      console.error('[DesignView] generate error:', err)
    } finally {
      setGenerating(false)
    }
  }

  // ── Iterate ───────────────────────────────────────────────────────────────

  const handleIterateRequest = useCallback((frameId: string) => {
    setIteratingFrameId(frameId)
    setIteratePrompt('')
  }, [])

  async function handleIterateSubmit() {
    const p = iteratePrompt.trim()
    if (!p || !iteratingFrameId) return

    // Special case: iterating from the seed frame (no code — use text-only context)
    if (iteratingFrameId === SEED_FRAME_ID) {
      const slot = prepareGenerate()
      const parentId = iteratingFrameId
      setIteratingFrameId(null)
      setIteratePrompt('')
      try {
        const { generationId } = await window.api.designGenerate({
          projectId,
          prompt: `This is an iteration on the current state of the project. ${p}`,
        })
        addLoadingFrames([{
          id: slot.frameId,
          generationId,
          prompt: p,
          position: slot.position,
          parentFrameId: parentId,
        }])
      } catch (err) {
        console.error('[DesignView] seed iterate error:', err)
      }
      return
    }

    const parent = currentDesign?.frames.find((f) => f.id === iteratingFrameId)
    if (!parent || parent.loading || !parent.code) return

    const slot = prepareIterate(iteratingFrameId)
    if (!slot) return

    const parentId = iteratingFrameId
    setIteratingFrameId(null)
    setIteratePrompt('')

    try {
      const { generationId } = await window.api.designIterateFrame({
        projectId,
        prompt: p,
        parentFrameId: parentId,
        parentFrameCode: parent.code,
        parentFramePrompt: parent.prompt,
      })
      addLoadingFrames([{
        id: slot.frameId,
        generationId,
        prompt: p,
        position: slot.position,
        parentFrameId: parentId,
      }])
    } catch (err) {
      console.error('[DesignView] iterate error:', err)
    }
  }

  // ── Implement ─────────────────────────────────────────────────────────────

  const handleImplementRequest = useCallback((frameId: string) => {
    // Prevent a second implementation from starting while one is in-flight
    if (useDesignImplementStore.getState().current.status === 'running') return
    setConfirmingFrameId(frameId)
  }, [])

  async function handleImplementConfirm() {
    if (!confirmingFrameId) return
    const frame = currentDesign?.frames.find((f) => f.id === confirmingFrameId)
    if (!frame || frame.loading || !frame.code) return

    setConfirmingFrameId(null)

    try {
      const { implementId } = await window.api.designImplementStart({
        projectId,
        frameCode: frame.code,
        frameKind: frame.kind,
        framePrompt: frame.prompt,
      })
      startPending(implementId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DesignView] implement error:', msg)
      setImplementStartError(msg)
      if (implementErrorTimerRef.current) clearTimeout(implementErrorTimerRef.current)
      implementErrorTimerRef.current = setTimeout(() => setImplementStartError(null), 4000)
    }
  }

  // ── Name editing ──────────────────────────────────────────────────────────

  function startNameEdit() {
    setNameDraft(currentDesign?.name ?? '')
    setNameEditing(true)
  }

  function commitNameEdit() {
    const trimmed = nameDraft.trim()
    // Only rename if the name actually changed — avoids a spurious isDirty + auto-save
    if (trimmed && trimmed !== currentDesign?.name) renameCurrentDesign(trimmed)
    setNameEditing(false)
  }

  // Lookup frame for confirm modal
  const confirmingFrame = confirmingFrameId
    ? currentDesign?.frames.find((f) => f.id === confirmingFrameId) ?? null
    : null

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Top bar */}
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <button
          onClick={() => setView('workspace')}
          title="Back to workspace"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* Project name prefix — read-only, gives visual scope */}
        {activeProject && (
          <>
            <span className="flex-shrink-0 text-xs text-zinc-600">{activeProject.name}</span>
            <span className="flex-shrink-0 text-xs text-zinc-700">/</span>
          </>
        )}

        {/* Design name — editable inline */}
        {nameEditing ? (
          <input
            autoFocus
            className="h-6 w-48 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-zinc-500"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNameEdit()
              if (e.key === 'Escape') setNameEditing(false)
            }}
          />
        ) : (
          <button
            onClick={startNameEdit}
            className="truncate text-xs font-medium text-zinc-300 hover:text-zinc-100"
            title="Click to rename"
          >
            {currentDesign?.name ?? 'Untitled design'}
          </button>
        )}

        <div className="flex-1" />

        {/* Load dropdown */}
        <div className="relative">
          <button
            onClick={() => setLoadMenuOpen((v) => !v)}
            disabled={designs.length === 0}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:cursor-default disabled:opacity-40"
          >
            {designs.length > 0 ? `Load (${designs.length})` : 'Load'}
            <ChevronDown className="h-3 w-3" />
          </button>
          {loadMenuOpen && (
            <>
              <div className="fixed inset-0 z-[50]" onClick={() => setLoadMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-[60] w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                {designs.map((d) => (
                  <button
                    key={d.name}
                    onClick={() => void handleLoadDesign(d.name)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <span className="truncate">{d.name}</span>
                    <span className="ml-2 flex-shrink-0 text-zinc-600">
                      {new Date(d.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* New design */}
        <button
          onClick={() => newDesign()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>

        {/* Save */}
        <button
          onClick={handleManualSave}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          {saved ? (
            <Check className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Canvas — takes all remaining height */}
      <div className="relative min-h-0 flex-1">
        <DesignCanvas
          projectId={projectId}
          onIterateRequest={handleIterateRequest}
          onImplementRequest={handleImplementRequest}
        />
      </div>

      {/* Iterate overlay */}
      {iteratingFrameId && (
        <div className="flex items-center gap-2 border-t border-amber-900/40 bg-amber-950/30 px-3 py-2">
          <span className="flex-shrink-0 text-xs text-amber-400">
            {iteratingFrameId === SEED_FRAME_ID ? 'Iterating from current state:' : 'Iterating on frame:'}
          </span>
          <input
            autoFocus
            placeholder="Describe your changes…"
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            value={iteratePrompt}
            onChange={(e) => setIteratePrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleIterateSubmit()
              if (e.key === 'Escape') setIteratingFrameId(null)
            }}
          />
          <button
            onClick={() => void handleIterateSubmit()}
            disabled={!iteratePrompt.trim()}
            className="flex-shrink-0 rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
          >
            Iterate
          </button>
          <button
            onClick={() => setIteratingFrameId(null)}
            className="flex-shrink-0 rounded-md px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Implement progress panel (shown while implementation is in-flight or done) */}
      {implementState.status !== 'idle' && implementState.implementId && (
        <ImplementProgressPanel onClose={resetImplement} />
      )}

      {/* Implement start error (IPC failure before the subprocess even started) */}
      {implementStartError && (
        <div className="flex items-center gap-2 border-t border-red-900/50 bg-red-950/30 px-3 py-2">
          <span className="text-xs text-red-400">Failed to start implementation: {implementStartError}</span>
        </div>
      )}

      {/* Bottom command bar */}
      <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
        <input
          placeholder="Describe a design to generate…"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void handleGenerate() }}
          disabled={generating}
        />

        {/* Variant toggle + count selector */}
        <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1">
          <button
            onClick={() => setVariantMode((v) => !v)}
            className={[
              'text-xs transition-colors',
              variantMode ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            Variants
          </button>
          {variantMode && (
            <>
              <span className="text-zinc-700">|</span>
              {([2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setVariantCount(n)}
                  className={[
                    'h-5 w-5 rounded text-xs transition-colors',
                    variantCount === n
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300',
                  ].join(' ')}
                >
                  {n}
                </button>
              ))}
            </>
          )}
        </div>

        <button
          onClick={() => void handleGenerate()}
          disabled={!prompt.trim() || generating}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-40"
        >
          {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Generate
        </button>
      </div>

      {/* Implement confirmation modal */}
      {confirmingFrame && (
        <ImplementConfirmModal
          projectName={activeProject?.name ?? projectId}
          framePrompt={confirmingFrame.prompt}
          frameKind={confirmingFrame.kind}
          onConfirm={() => void handleImplementConfirm()}
          onCancel={() => setConfirmingFrameId(null)}
        />
      )}
    </div>
  )
}
