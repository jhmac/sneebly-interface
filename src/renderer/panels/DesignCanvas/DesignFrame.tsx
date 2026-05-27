import { useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { MoreHorizontal, Copy, Trash2, GitBranch, Loader2, AlertCircle, Download } from 'lucide-react'
import SandboxedArtifact from '../ChatPanel/SandboxedArtifact'
import { useDesignStore, FRAME_WIDTH, FRAME_HEIGHT } from '../../state/designStore'
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Body height = frame total minus header (40px), footer (28px), and 2px borders
const HEADER_H = 40
const FOOTER_H = 28
const BODY_H = FRAME_HEIGHT - HEADER_H - FOOTER_H - 2

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
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="text-xs text-red-400">Generation failed</p>
            <p className="text-[10px] text-zinc-500 line-clamp-3">{data.error}</p>
          </div>
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(ts: number): string {
  if (!ts) return ''
  const diffSec = Math.floor((Date.now() - ts) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}
