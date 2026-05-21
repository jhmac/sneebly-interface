import { FolderOpen } from 'lucide-react'
import { useProjectStore } from '../state/projectStore'

export default function Welcome() {
  const { openProjectDialog, loading } = useProjectStore()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-900">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
          <FolderOpen className="h-8 w-8 text-zinc-400" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-zinc-100">No project open</h1>
          <p className="max-w-xs text-sm text-zinc-500">
            Open a local project folder to get started. The folder should
            contain a <code className="text-zinc-400">package.json</code> and
            optionally a <code className="text-zinc-400">GOALS.md</code>.
          </p>
        </div>
        <button
          onClick={openProjectDialog}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600 disabled:opacity-50"
        >
          <FolderOpen className="h-4 w-4" />
          Open folder…
        </button>
      </div>
    </div>
  )
}
