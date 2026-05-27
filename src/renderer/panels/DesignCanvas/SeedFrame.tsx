import { type NodeProps, type Node, Handle, Position } from '@xyflow/react'
import { Camera, GitBranch } from 'lucide-react'
import { FRAME_WIDTH, FRAME_HEIGHT } from '../../state/designStore'
import { BODY_H, formatTimeAgo } from './frameUtils'

// ─── Data shape ───────────────────────────────────────────────────────────────

export interface SeedFrameData extends Record<string, unknown> {
  dataUrl: string
  capturedAt: number
  onIterate: (frameId: string) => void
}

export const SEED_FRAME_ID = 'seed-frame'

// ─── SeedFrame ────────────────────────────────────────────────────────────────

export default function SeedFrame({ data }: NodeProps<Node<SeedFrameData>>) {
  return (
    <div
      style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
      className="flex flex-col overflow-hidden rounded-xl border border-amber-700/50 bg-zinc-900 shadow-xl"
    >
      {/* React-flow connection handles */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#92400e', border: 'none', width: 8, height: 8 }}
      />

      {/* Header */}
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-amber-700/30 bg-zinc-950 px-3">
        <Camera className="h-3 w-3 flex-shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">Current state of project</span>
        <span className="flex-shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
          Current
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); data.onIterate(SEED_FRAME_ID) }}
          title="Iterate from this"
          className="flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <GitBranch className="h-3 w-3" />
          Iterate
        </button>
      </div>

      {/* Body — static screenshot */}
      <div
        className="relative flex-1 overflow-hidden bg-white"
        style={{ height: BODY_H }}
      >
        <img
          src={data.dataUrl}
          alt="Current project preview"
          className="h-full w-full object-cover object-top"
          draggable={false}
        />
      </div>

      {/* Footer */}
      <div className="flex h-7 flex-shrink-0 items-center border-t border-zinc-800 px-3">
        <span className="text-[10px] text-zinc-600">
          Captured {formatTimeAgo(data.capturedAt)}
        </span>
      </div>
    </div>
  )
}

