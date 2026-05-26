import { useChatContext } from './useChatContext'
import { useProjectStore } from '../../state/projectStore'
import { useEditorStore } from '../../state/editorStore'

function toRelative(filePath: string, projectPath: string): string {
  return filePath.startsWith(projectPath + '/') ? filePath.slice(projectPath.length + 1) : filePath
}

export default function ContextChip() {
  const ctx = useChatContext()
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
  const openFile = useEditorStore((s) => s.openFile)

  const clickable = ctx.kind !== 'general' && ctx.filePath != null && activeProject != null

  function onClick() {
    if (!clickable || !activeProject || !ctx.filePath) return
    openFile(activeProject.path, activeProject.id, toRelative(ctx.filePath, activeProject.path))
  }

  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      title={ctx.tooltip}
      className={[
        'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
        ctx.kind === 'general'
          ? 'text-zinc-600'
          : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
        clickable ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
    >
      <span className="text-zinc-600">Context:</span>
      <span className="max-w-[160px] truncate">{ctx.label}</span>
    </button>
  )
}
