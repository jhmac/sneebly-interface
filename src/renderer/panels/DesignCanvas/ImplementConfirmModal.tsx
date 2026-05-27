import { AlertTriangle } from 'lucide-react'
import type { ArtifactKind } from '../../../shared/types'

interface Props {
  projectName: string
  framePrompt: string
  frameKind: ArtifactKind
  onConfirm: () => void
  onCancel: () => void
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: 'HTML', react: 'JSX', svg: 'SVG', mermaid: 'Mermaid',
}

export default function ImplementConfirmModal({
  projectName,
  framePrompt,
  frameKind,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-black/60"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[210] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Implement design into project?</h2>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
            <Row label="Project" value={projectName} />
            <Row label="Frame" value={framePrompt.length > 80 ? framePrompt.slice(0, 77) + '…' : framePrompt} />
            <Row label="Type" value={KIND_LABEL[frameKind]} />
          </div>

          <p className="text-xs text-zinc-500 leading-relaxed">
            Sneebly will read your project structure and modify files to match this design.
            This may overwrite existing code. Use git to review or revert changes.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-amber-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-600"
          >
            Implement
          </button>
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-14 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-600">{label}</span>
      <span className="min-w-0 break-words text-xs text-zinc-300">{value}</span>
    </div>
  )
}
