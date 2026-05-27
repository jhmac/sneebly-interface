import { useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { MoreHorizontal, Copy, Trash2, GitBranch, Loader2, AlertCircle, Download, Hammer } from 'lucide-react'
import SandboxedArtifact from '../ChatPanel/SandboxedArtifact'
import { useDesignStore, FRAME_WIDTH, FRAME_HEIGHT } from '../../state/designStore'
import { BODY_H, formatTimeAgo } from './frameUtils'
import type { ArtifactKind } from '../../../shared/types'

// ─── Data shape ───────────────────────────────────────────────────────────────

export interface DesignFrameData extends Record<string, unknown> {
  frameId: string
  projectId: string
  code: string
  kind: ArtifactKind
  prompt: string
  parentFrameId?: string
  generatedAt: number
  loading: boolean
  error?: string
  generationId?: string
  onIterate: (frameId: string) => void
  onImplement: (frameId: string) => void
}

// ─── Error helpers ────────────────────────────────────────────────────────────

const ERROR_CHAR_THRESHOLD = 120

function classifyError(error: string): string {
  const lower = error.toLowerCase()
  if (/not logged in|not authenticated|authentication|unauthorized|401/.test(lower))
    return 'Not logged in'
  if (/rate limit|overloaded|too many requests|429/.test(lower))
    return 'Rate limit hit'
  if (/context window|context.length|too (many|large)|maximum (context|length)|token.*(limit|exceed)/.test(lower))
    return 'Context too large'
  if (/enoent|spawn.*failed|command not found|no such file/.test(lower) && lower.includes('claude'))
    return 'claude CLI not found'
  if (/econnrefused|network|connection refused/.test(lower))
    return 'Network error'
  const first = error.split('\n')[0] ?? error
  return first.length > 60 ? `${first.slice(0, 57)}…` : first
}

function FrameError({ error }: { error: string }) {
  const [expanded, setExpanded] = useState(false)
  const headline = classifyError(error)
  const isLong = error.length > ERROR_CHAR_THRESHOLD
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
      <p className="text-xs font-medium text-red-400">{headline}</p>
      {!isLong && headline !== error && (
        <p className="max-w-full break-words text-[10px] text-zinc-500">{error}</p>
      )}
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-zinc-500 underline transition-colors hover:text-zinc-300"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {isLong && expanded && (
        <div className="w-full max-h-36 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-left">
          <pre className="whitespace-pre-wrap break-all text-[9px] text-zinc-400">{error}</pre>
        </div>
      )}
      <button
        onClick={() => { void navigator.clipboard.writeText(error) }}
        className="flex items-center gap-1 text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
      >
        <Copy className="h-2.5 w-2.5" />
        Copy error
      </button>
    </div>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

// BODY_H imported from frameUtils (shared with SeedFrame)

const KIND_COLORS: Record<ArtifactKind, string> = {
  html:    'bg-orange-900/40 text-orange-300',
  react:   'bg-blue-900/40 text-blue-300',
  svg:     'bg-green-900/40 text-green-300',
  mermaid: 'bg-purple-900/40 text-purple-300',
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: 'HTML', react: 'JSX', svg: 'SVG', mermaid: 'Mermaid',
}

const SAVE_EXT: Record<ArtifactKind, string> = {
  html: 'html', react: 'jsx', svg: 'svg', mermaid: 'md',
}

// ─── DesignFrame ──────────────────────────────────────────────────────────────

export default function DesignFrame({ data }: NodeProps<Node<DesignFrameData>>) {
  const { removeFrame, duplicateFrame } = useDesignStore()
  const [menuOpen, setMenuOpen] = useState(false)

  const promptTrunc = data.prompt.length > 60 ? data.prompt.slice(0, 57) + '…' : data.prompt

  function handleCancel() {
    // Fire-and-forget the cancel IPC so the subprocess stops; then drop the frame
    if (data.generationId) {
      window.api.designCancel({ generationId: data.generationId }).catch(console.error)
    }
    removeFrame(data.frameId)
    // No need to close menu — frame removal unmounts this node entirely
  }

  function handleDelete() {
    removeFrame(data.frameId)
  }

  function handleSaveToFile() {
    setMenuOpen(false)
    window.api.chatSaveArtifact({ content: data.code, defaultExt: SAVE_EXT[data.kind] }).catch(console.error)
  }

  return (
    <div
      style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
      className="flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
    >
      {/* React-flow connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#52525b', border: 'none', width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#52525b', border: 'none', width: 8, height: 8 }}
      />

      {/* Header */}
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-zinc-700 bg-zinc-950 px-3">
        <span
          className="min-w-0 flex-1 truncate text-xs text-zinc-400"
          title={data.prompt}
        >
          {promptTrunc}
        </span>
        {!data.loading && !data.error && (
          <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_COLORS[data.kind]}`}>
            {KIND_LABEL[data.kind]}
          </span>
        )}
        <div className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-6 z-[110] w-40 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                {!data.loading && !data.error && (
                  <>
                    <MenuButton
                      icon={<Hammer className="h-3 w-3" />}
                      label="Implement"
                      onClick={() => { setMenuOpen(false); data.onImplement(data.frameId) }}
                    />
                    <MenuButton
                      icon={<GitBranch className="h-3 w-3" />}
                      label="Iterate"
                      onClick={() => { setMenuOpen(false); data.onIterate(data.frameId) }}
                    />
                    <MenuButton
                      icon={<Copy className="h-3 w-3" />}
                      label="Duplicate"
                      onClick={() => { setMenuOpen(false); duplicateFrame(data.frameId) }}
                    />
                    <MenuButton
                      icon={<Download className="h-3 w-3" />}
                      label="Save to file"
                      onClick={handleSaveToFile}
                    />
                    <div className="my-1 border-t border-zinc-800" />
                  </>
                )}
                {data.loading ? (
                  <MenuButton
                    icon={<Trash2 className="h-3 w-3" />}
                    label="Cancel"
                    onClick={handleCancel}
                    danger
                  />
                ) : (
                  <MenuButton
                    icon={<Trash2 className="h-3 w-3" />}
                    label="Delete"
                    onClick={handleDelete}
                    danger
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        className="relative flex-1 overflow-hidden bg-zinc-950"
        style={{ height: BODY_H }}
      >
        {data.loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="max-w-[80%] text-center text-xs">Generating…</span>
          </div>
        ) : data.error ? (
          <FrameError error={data.error} />
        ) : (
          /* Fixed-height overflow wrapper — prevents SandboxedArtifact's postMessage
             height changes from shifting adjacent react-flow nodes. The iframe can
             still scroll within this clipped box. */
          <div style={{ height: BODY_H, overflow: 'hidden' }}>
            <SandboxedArtifact kind={data.kind} code={data.code} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex h-7 flex-shrink-0 items-center border-t border-zinc-800 px-3">
        <span className="text-[10px] text-zinc-600">{formatTimeAgo(data.generatedAt)}</span>
      </div>
    </div>
  )
}

// ─── MenuButton ───────────────────────────────────────────────────────────────

function MenuButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800',
        danger ? 'text-red-400' : 'text-zinc-300',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

