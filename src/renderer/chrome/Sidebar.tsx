import { FolderOpen, FolderCode } from 'lucide-react'
import { useProjectStore } from '../state/projectStore'

export default function Sidebar() {
  const { projects, activeProjectId, requestProjectSwitch, openProjectDialog, loading } =
    useProjectStore()

  return (
    <div className="flex h-full w-48 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Projects
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-600">No projects yet</p>
        ) : (
          <ul className="flex flex-col gap-0.5 px-1.5">
            {[...projects]
              .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
              .map((project) => {
                const isActive = project.id === activeProjectId
                return (
                  <li key={project.id}>
                    <button
                      onClick={() => requestProjectSwitch(project.id)}
                      className={[
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                      ].join(' ')}
                    >
                      <FolderCode className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </button>
                  </li>
                )
              })}
          </ul>
        )}
      </div>

      <div className="border-t border-zinc-800 p-2">
        <button
          onClick={openProjectDialog}
          disabled={loading}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
        >
          <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Open folder…</span>
        </button>
      </div>
    </div>
  )
}
