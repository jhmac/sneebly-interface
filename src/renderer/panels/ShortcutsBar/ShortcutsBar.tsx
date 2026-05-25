import { useState } from 'react'
import { File, Zap, FileCode, Pin, X } from 'lucide-react'
import type { Shortcut, ShortcutAction } from '../../../shared/types'
import { useShortcutsStore } from '../../state/shortcutsStore'

interface Props {
  projectId: string
  showSuggested: boolean
  onAction: (action: ShortcutAction) => void
}

export default function ShortcutsBar({ projectId, showSuggested, onAction }: Props) {
  const { file, pin, unpin } = useShortcutsStore()
  const { pinned, suggested } = file

  const visibleSuggested = showSuggested ? suggested : []
  if (pinned.length === 0 && visibleSuggested.length === 0) return null

  return (
    <div className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-3 overflow-x-auto">
      {pinned.map((s) => (
        <ShortcutPill
          key={s.id}
          shortcut={s}
          onAction={() => onAction(s.action)}
          onRemove={() => unpin(projectId, s.id)}
        />
      ))}

      {visibleSuggested.length > 0 && pinned.length > 0 && (
        <div className="h-4 w-px flex-shrink-0 bg-zinc-800" />
      )}

      {visibleSuggested.map((s) => (
        <ShortcutPill
          key={s.id}
          shortcut={s}
          onAction={() => onAction(s.action)}
          onPin={() => pin(projectId, s.id)}
          onRemove={() => unpin(projectId, s.id)}
          suggested
        />
      ))}
    </div>
  )
}

function ShortcutIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'zap': return <Zap className="h-3 w-3 flex-shrink-0" />
    case 'file-code': return <FileCode className="h-3 w-3 flex-shrink-0" />
    default: return <File className="h-3 w-3 flex-shrink-0" />
  }
}

function ShortcutPill({
  shortcut,
  onAction,
  onPin,
  onRemove,
  suggested = false,
}: {
  shortcut: Shortcut
  onAction: () => void
  onPin?: () => void
  onRemove: () => void
  suggested?: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="group relative flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onAction}
        title={suggested ? shortcut.reason : shortcut.label}
        className={[
          'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors',
          suggested
            ? 'border border-dashed border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            : 'bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
        ].join(' ')}
      >
        <ShortcutIcon icon={shortcut.icon} />
        <span className="max-w-[120px] truncate">{shortcut.label}</span>
      </button>

      {hovered && (
        <div className="absolute -right-1 -top-1 flex gap-0.5 z-10">
          {onPin && (
            <button
              onClick={(e) => { e.stopPropagation(); onPin() }}
              title="Pin to bar"
              className="rounded bg-zinc-700 p-0.5 text-zinc-300 hover:bg-zinc-600"
            >
              <Pin className="h-2.5 w-2.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            title={suggested ? 'Dismiss' : 'Remove from bar'}
            className="rounded bg-zinc-700 p-0.5 text-zinc-300 hover:bg-zinc-600"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      )}
    </div>
  )
}
