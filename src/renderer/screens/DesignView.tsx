import { useCallback, useEffect, useRef, useState } from 'react'
import { Layout, Plus, Save, ChevronDown, Loader2, Check } from 'lucide-react'
import DesignCanvas from '../panels/DesignCanvas/DesignCanvas'
import { useDesignStore } from '../state/designStore'
import type { DesignFile } from '../../shared/types'

interface Props {
  projectId: string
}

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

  useEffect(() => {
    window.api.designList(projectId).then(setDesigns).catch(console.error)
    if (!currentDesign) newDesign()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // ── Auto-save (debounced 500ms after any change) ───────────────────────────

  useEffect(() => {
    if (!currentDesign) return
    // Only save frames that have finished generating (not loading placeholders)
    const framesDone = currentDesign.frames.filter((f) => !f.loading && !f.error && f.code)
    if (framesDone.length === 0 && currentDesign.frames.length > 0) return
    const file: DesignFile = {
      name: currentDesign.name,
      createdAt: currentDesign.createdAt,
      updatedAt: currentDesign.updatedAt,
      frames: framesDone.map((f) => ({
        id: f.id,
        position: f.position,
        code: f.code,
        kind: f.kind,
        prompt: f.prompt,
        parentFrameId: f.parentFrameId,
        generatedAt: f.generatedAt,
      })),
    }
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
    const file: DesignFile = {
      name: currentDesign.name,
      createdAt: currentDesign.createdAt,
      updatedAt: Date.now(),
      frames: currentDesign.frames
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

  // ── Cleanup timer on unmount ───────────────────────────────────────────────
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
        const slots = prepareVariants(p, variantCount)
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
        const slot = prepareGenerate(p)
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

    const slot = prepareIterate(iteratingFrameId, p)
    if (!slot) return

    setIteratingFrameId(null)
    setIteratePrompt('')

    try {
      const { generationId } = await window.api.designIterateFrame({
        projectId,
        prompt: p,
        parentFrameId: iteratingFrameId,
        parentFrameCode: parent.code,
        parentFramePrompt: parent.prompt,
      })
      addLoadingFrames([{
        id: slot.frameId,
        generationId,
        prompt: p,
        position: slot.position,
        parentFrameId: iteratingFrameId,
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

      {/* Iterate overlay — shown when a frame is selected for iteration */}
      {iteratingFrameId && (
        <div className="flex items-center gap-2 border-t border-amber-900/40 bg-amber-950/30 px-3 py-2">
          <span className="text-xs text-amber-400 flex-shrink-0">Iterating on frame:</span>
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

        {/* Variant toggle + count */}
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
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Generate
        </button>
      </div>
    </div>
  )
}
