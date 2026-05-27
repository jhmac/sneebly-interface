import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Copy, Download, Check } from 'lucide-react'
import SandboxedArtifact from './SandboxedArtifact'
import type { ArtifactKind } from '../../../shared/types'

interface Props {
  kind: ArtifactKind
  code: string
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  html:    'HTML',
  react:   'React',
  svg:     'SVG',
  mermaid: 'Mermaid',
}

const KIND_EXT: Record<ArtifactKind, string> = {
  html:    'html',
  react:   'jsx',
  svg:     'svg',
  mermaid: 'md',
}

// ─── ArtifactBlock ───────────────────────────────────────────────────────────

export default function ArtifactBlock({ kind, code }: Props) {
  const [copied, setCopied] = useState(false)
  const [saved,  setSaved]  = useState(false)

  // Track timers so we can cancel them on unmount and avoid setState on a
  // component that has already been removed from the tree.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    if (savedTimer.current)  clearTimeout(savedTimer.current)
  }, [])

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      setCopied(true)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  async function handleSave() {
    try {
      await window.api.chatSaveArtifact({ content: code, defaultExt: KIND_EXT[kind] })
      if (savedTimer.current) clearTimeout(savedTimer.current)
      setSaved(true)
      savedTimer.current = setTimeout(() => setSaved(false), 1500)
    } catch {
      // User cancelled the save dialog — nothing to do
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-900 px-3 py-1.5">
        <span className="text-xs font-semibold text-zinc-400">{KIND_LABEL[kind]}</span>
        <div className="flex items-center gap-1">
          <ToolbarButton
            onClick={handleCopy}
            icon={copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            label={copied ? 'Copied' : 'Copy'}
          />
          <ToolbarButton
            onClick={handleSave}
            icon={saved ? <Check className="h-3 w-3 text-green-400" /> : <Download className="h-3 w-3" />}
            label={saved ? 'Saved' : 'Save'}
          />
        </div>
      </div>

      {/* Live sandboxed preview */}
      <SandboxedArtifact kind={kind} code={code} />
    </div>
  )
}

// ─── ToolbarButton ───────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void | Promise<void>
  icon: ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
    >
      {icon}
      {label}
    </button>
  )
}
