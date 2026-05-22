import { useState } from 'react'
import { FolderOpen, GitBranch } from 'lucide-react'
import { useProjectStore } from '../state/projectStore'
import { useGitHubStore } from '../state/githubStore'
import GitHubConnectModal from '../panels/GitHubPanel/GitHubConnectModal'
import GitHubRepoPickerModal from '../panels/GitHubPanel/GitHubRepoPickerModal'
import type { GitHubUser } from '../../shared/types'

export default function Welcome() {
  const { openProjectDialog, loading } = useProjectStore()
  const { connected, user } = useGitHubStore()
  const [showConnect, setShowConnect] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  function handleConnected(connectedUser: GitHubUser) {
    useGitHubStore.getState().setConnected(connectedUser)
    setShowConnect(false)
    setShowPicker(true)
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-900">
      {showConnect && (
        <GitHubConnectModal
          onClose={() => setShowConnect(false)}
          onConnected={handleConnected}
        />
      )}
      {showPicker && (
        <GitHubRepoPickerModal onClose={() => setShowPicker(false)} />
      )}

      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
          <FolderOpen className="h-8 w-8 text-zinc-400" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-zinc-100">No project open</h1>
          <p className="max-w-xs text-sm text-zinc-500">
            Open a local project folder or clone one from GitHub.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={openProjectDialog}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600 disabled:opacity-50"
          >
            <FolderOpen className="h-4 w-4" />
            Open folder…
          </button>

          {connected && user ? (
            <button
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <GitBranch className="h-4 w-4" />
              Browse repos (@{user.login})
            </button>
          ) : (
            <button
              onClick={() => setShowConnect(true)}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <GitBranch className="h-4 w-4" />
              Connect GitHub
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
