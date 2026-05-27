import { useCallback, useEffect, useRef, useState } from 'react'
import { Layout, Plus, Save, ChevronDown, Loader2, Check } from 'lucide-react'
import DesignCanvas from '../panels/DesignCanvas/DesignCanvas'
import { useDesignStore } from '../state/designStore'
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
    designs,
    setDesigns,
    newDesign,
    loadDesignData,
    renameCurrentDesign,
    addLoadingFrames,
    prepareGenerate,
    prepareVariants,
    prepareIterate,
  } = useDesignStore()

  const [prompt, setPrompt] = useState('')
  const [variantMode, setVariantMode] = useState(false)
  const [variantCount, setVariantCount] = useState(4)
  const [iteratingFrameId, setIteratingFrameId] = useState<string | null>(null)
  const [iteratePrompt, setIteratePrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [loadMenuOpen, setLoadMenuOpen] = useState(false)

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  // Runs when projectId changes (i.e. on first mount for this project).
  // App.tsx already calls newDesign() on project switch, so currentDesign is
  // always fresh here — we just need to load the designs list.

  useEffect(() => {
    window.api.designList(projectId).then(setDesigns).catch(console.error)
    // If no design has been created yet (first visit before App.tsx effect ran),
    // create one now as a fallback.
    if (!currentDesign) newDesign()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // ── Auto-save (debounced 500ms after any change) ───────────────────────────
  // Guard: skip if there are no completed frames to persist.

  useEffect(() => {
    if (!currentDesign) return
    const file = toDesignFile(currentDesign)
    // Don't write an empty-frames file — only save once at least one frame is done
    if (file.frames.length === 0) return

    const timer = setTimeout(() => {
      window.api.designSave(projectId, file)
        .then(() => window.api.designList(projectId))
        .then(setDesigns)
        .catch(console.error)
    }, 500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDesign])

  // ── Manual save ───────────────────────────────────────────────────────────

  function handleManualSave() {
    if (!currentDesign) return
    const file = toDesignFile({ ...currentDesign, updatedAt: Date.now() })
    window.api.designSave(projectId, file)
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
  // Re-registers whenever currentDesign changes so the closure captures the latest value.

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

    const parent = currentDesign?.frames.find((f) => f.id === iteratingFrameId)
    if (!parent || parent.loading || !parent.code) return

    const slot = prepareIterate(iteratingFrameId)
    if (!slot) return

    // Capture before clearing state (React doesn't update synchronously)
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

  // ── Name editing ──────────────────────────────────────────────────────────

  function startNameEdit() {
    setNameDraft(currentDesign?.name ?? '')
    setNameEditing(true)
  }

  function commitNameEdit() {
    const trimmed = nameDraft.trim()
    if (trimmed) renameCurrentDesign(trimmed)
    setNameEditing(false)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Top bar */}
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <Layout className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />

        {/* Design name */}
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
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            Load
            <ChevronDown className="h-3 w-3" />
          </button>
          {loadMenuOpen && (
            <>
              <div className="fixed inset-0 z-[50]" onClick={() => setLoadMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-[60] w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                {designs.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-zinc-600">No saved designs</p>
                ) : (
                  designs.map((d) => (
                    <button
                      key={d.name}
                      onClick={() => handleLoadDesign(d.name)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      <span className="truncate">{d.name}</span>
                      <span className="ml-2 flex-shrink-0 text-zinc-600">
                        {new Date(d.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                  ))
                )}
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
        <DesignCanvas projectId={projectId} onIterateRequest={handleIterateRequest} />
      </div>

      {/* Iterate overlay — shown when the user picks "Iterate" from a frame's menu */}
      {iteratingFrameId && (
        <div className="flex items-center gap-2 border-t border-amber-900/40 bg-amber-950/30 px-3 py-2">
          <span className="flex-shrink-0 text-xs text-amber-400">Iterating on frame:</span>
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
            onClick={handleIterateSubmit}
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
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-40"
        >
          {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Generate
        </button>
      </div>
    </div>
  )
}
