import { useState } from 'react'
import { FolderOpen, FolderCode, Trash2 } from 'lucide-react'
import { useProjectStore } from '../state/projectStore'
import { useDaemonStore } from '../state/daemonStore'
import type { Project } from '../../shared/types'

function StatusDot({ className }: { className: string }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${className}`} />
}

function RemoveProjectModal({
  project,
  onCancel,
  onConfirm,
}: {
  project: Project
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
      <div className="flex w-96 flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-zinc-100">Remove project?</p>
          <p className="text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">{project.name}</span> will be removed from
            Sneebly's project list. The files on disk are NOT deleted — just unregistered. You can
            re-add the folder later via "Open folder…".
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const { projects, activeProjectId, requestProjectSwitch, openProjectDialog, loading } =
    useProjectStore()
  const { status, questionCounts, openModal } = useDaemonStore()
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)

  const totalQuestions = Object.values(questionCounts).reduce((a, b) => a + b, 0)
  const activeCycleProjectId = status?.activeCycle?.projectId ?? null
  const enabledSet = new Set(status?.enabledProjectIds ?? [])

  const activeCyclingName = activeCycleProjectId
    ? (projects.find((p) => p.id === activeCycleProjectId)?.name ?? 'removed project')
    : null

  async function handleConfirmRemove() {
    if (!confirmDelete) return
    await window.api.projectRemove(confirmDelete.id)
    // If the removed project was active, clear active state before reloading
    if (useProjectStore.getState().activeProjectId === confirmDelete.id) {
      useProjectStore.setState({ activeProjectId: null, activeProjectBranch: null, activeProjectGoals: null })
    }
    await useProjectStore.getState().loadProjects()
    setConfirmDelete(null)
  }

  return (
    <div className="flex h-full w-48 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="pt-8 px-3 pb-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
          Sneebly
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Projects
          </span>
          <button
            onClick={openProjectDialog}
            disabled={loading}
            title="Open folder…"
            className="flex items-center justify-center h-5 w-5 rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-50 text-base leading-none"
          >
            +
          </button>
        </div>
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
                const isCycling = project.id === activeCycleProjectId
                const isEnabled = enabledSet.has(project.id)
                return (
                  <li key={project.id}>
                    <div className="group relative">
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
                        <span className="truncate flex-1">{project.name}</span>
                        <span className="group-hover:hidden">
                          {isCycling ? (
                            <StatusDot className="bg-amber-400 animate-pulse" />
                          ) : isEnabled ? (
                            <StatusDot className="bg-green-500" />
                          ) : (
                            <StatusDot className="bg-zinc-600" />
                          )}
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDelete(project)
                        }}
                        title={`Remove ${project.name}`}
                        className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center h-5 w-5 rounded text-zinc-500 hover:bg-red-900/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </div>

      {/* Daemon section */}
      <div className="border-t border-zinc-800 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Daemon
        </span>

        {/* Status row */}
        <div className="mt-1.5 flex items-center gap-1.5 px-1">
          {!status?.running ? (
            <>
              <StatusDot className="bg-zinc-600" />
              <span className="text-xs text-zinc-500">Off</span>
            </>
          ) : activeCyclingName ? (
            <>
              <StatusDot className="bg-amber-400 animate-pulse" />
              <span className="truncate text-xs text-amber-300">
                Cycling: {activeCyclingName}
              </span>
            </>
          ) : (
            <>
              <StatusDot className="bg-green-500" />
              <span className="text-xs text-zinc-400">Idle</span>
            </>
          )}
        </div>

        {/* Action rows */}
        <div className="mt-1 flex flex-col gap-0.5">
          <button
            onClick={() => openModal('queue')}
            className="flex w-full items-center justify-between rounded px-1 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <span>Queue</span>
            {(status?.queueLength ?? 0) > 0 && (
              <span className="rounded-full bg-indigo-600 px-1.5 py-0 text-[10px] text-white">
                {status?.queueLength}
              </span>
            )}
          </button>
          <button
            onClick={() => openModal('questions')}
            className="flex w-full items-center justify-between rounded px-1 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <span>Questions</span>
            {totalQuestions > 0 && (
              <span className="rounded-full bg-amber-600 px-1.5 py-0 text-[10px] text-white">
                {totalQuestions}
              </span>
            )}
          </button>
          <button
            onClick={() => openModal('settings')}
            className="flex w-full items-center rounded px-1 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            Settings
          </button>
        </div>
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

      {confirmDelete && (
        <RemoveProjectModal
          project={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleConfirmRemove}
        />
      )}
    </div>
  )
}
