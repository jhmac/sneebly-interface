import { useEffect, useRef, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
} from 'react-resizable-panels'
import { GitBranch, ChevronDown, ChevronUp, KeyRound, Settings, FolderTree, FileCode, X } from 'lucide-react'
import type { LayoutSizes } from '../../shared/types'
import { useProjectStore } from '../state/projectStore'
import { useSecretsStore } from '../state/secretsStore'
import { useFilesStore } from '../state/filesStore'
import { useEditorStore } from '../state/editorStore'
import { useActivityPanelStore } from '../state/activityPanelStore'
import { useGitStatusStore } from '../state/gitStatusStore'
import CommitPushModal from '../panels/GitHubPanel/CommitPushModal'
import SpecGeneratorModal from '../panels/SpecPanel/SpecGeneratorModal'
import { useSpecStore } from '../state/specStore'
import PreviewPanel from '../panels/PreviewPanel'
import ChatPanel from '../panels/ChatPanel/ChatPanel'
import ActivityPanel from '../panels/ActivityPanel/ActivityPanel'
import SecretsPanel from '../panels/SecretsPanel/SecretsPanel'
import SettingsPanel from '../panels/SettingsPanel/SettingsPanel'
import EditorPanel from '../panels/FilesPanel/EditorPanel'

const DEFAULT_SIZES: LayoutSizes = {
  vertical: { preview: 55, bottom: 45 },
  horizontal: { chat: 50, activity: 50 },
}

export default function Workspace() {
  const verticalRef = useGroupRef()
  const horizontalRef = useGroupRef()
  const sizesRef = useRef<LayoutSizes>(DEFAULT_SIZES)

  const {
    projects,
    activeProjectId,
    activeProjectBranch,
    activeProjectGoals,
    goalsExpanded,
    setGoalsExpanded,
    pendingProjectSwitch,
    confirmProjectSwitch,
    cancelProjectSwitch,
  } = useProjectStore()

  const { openPanel: openSecrets } = useSecretsStore()
  const { resetForProject } = useFilesStore()
  const { setActiveTab } = useActivityPanelStore()
  const { status: gitStatus, openCommitModal, commitModalOpen, closeCommitModal } = useGitStatusStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { openModal: openSpecModal } = useSpecStore()

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  // Open files count badge
  const openFilesCount = useEditorStore(
    (s) => (s.openFilesByProject[activeProjectId ?? ''] ?? []).length
  )

  // Reset file tree when project changes
  useEffect(() => {
    resetForProject()
  }, [activeProjectId])

  useEffect(() => {
    window.api.layoutGetSizes().then((loaded) => {
      if (!loaded) return
      sizesRef.current = loaded
      verticalRef.current?.setLayout(loaded.vertical)
      horizontalRef.current?.setLayout(loaded.horizontal)
    })
  }, [])

  function handleVerticalLayout(layout: Layout): void {
    sizesRef.current = { ...sizesRef.current, vertical: layout }
    window.api.layoutSetSizes(sizesRef.current)
  }

  function handleHorizontalLayout(layout: Layout): void {
    sizesRef.current = { ...sizesRef.current, horizontal: layout }
    window.api.layoutSetSizes(sizesRef.current)
  }

  function handleOpenFiles() {
    setActiveTab('files')
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-900 text-zinc-100">
      {/* Modals */}
      <SecretsPanel />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <EditorPanel />
      {commitModalOpen && <CommitPushModal onClose={closeCommitModal} />}
      <SpecGeneratorModal />

      {/* Project switch dirty-files guard */}
      {pendingProjectSwitch && (
        <UnsavedChangesModal
          currentProjectName={activeProject?.name ?? 'current project'}
          onSaveAll={() => confirmProjectSwitch('save-all')}
          onDiscardAll={() => confirmProjectSwitch('discard-all')}
          onCancel={cancelProjectSwitch}
        />
      )}

      {/* Workspace header */}
      <WorkspaceHeader
        projectName={activeProject?.name ?? null}
        branch={activeProjectBranch}
        hasGoals={activeProjectGoals !== null}
        goalsExpanded={goalsExpanded}
        onToggleGoals={() => setGoalsExpanded(!goalsExpanded)}
        onOpenSecrets={openSecrets}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFiles={handleOpenFiles}
        openFilesCount={openFilesCount}
        gitChangedFiles={gitStatus?.changedFiles ?? 0}
        gitAhead={gitStatus?.ahead ?? 0}
        gitBehind={gitStatus?.behind ?? 0}
        onOpenCommit={openCommitModal}
        onOpenSpecs={openSpecModal}
      />

      {/* Goals expander */}
      {goalsExpanded && activeProjectGoals && (
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3">
          <GoalsSummary goals={activeProjectGoals} />
        </div>
      )}

      {/* Three-panel layout */}
      <div className="flex-1 overflow-hidden">
        <Group
          groupRef={verticalRef}
          orientation="vertical"
          defaultLayout={DEFAULT_SIZES.vertical}
          onLayoutChanged={handleVerticalLayout}
          className="h-full"
        >
          <Panel id="preview" defaultSize={55} minSize={20}>
            <PreviewPanel />
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel id="bottom" defaultSize={45} minSize={20}>
            <Group
              groupRef={horizontalRef}
              orientation="horizontal"
              defaultLayout={DEFAULT_SIZES.horizontal}
              onLayoutChanged={handleHorizontalLayout}
              className="h-full"
            >
              <Panel id="chat" defaultSize={50} minSize={20}>
                <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel id="activity" defaultSize={50} minSize={20}>
                <ActivityPanel />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </div>
  )
}

function UnsavedChangesModal({
  currentProjectName,
  onSaveAll,
  onDiscardAll,
  onCancel,
}: {
  currentProjectName: string
  onSaveAll: () => void
  onDiscardAll: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
      <div className="flex w-96 flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <p className="text-sm text-zinc-200">
            You have unsaved changes in{' '}
            <span className="font-medium text-zinc-100">{currentProjectName}</span>.
          </p>
          <button onClick={onCancel} className="ml-3 flex-shrink-0 text-zinc-600 hover:text-zinc-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDiscardAll}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Discard all
          </button>
          <button
            onClick={onSaveAll}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            Save all
          </button>
        </div>
      </div>
    </div>
  )
}

function WorkspaceHeader({
  projectName,
  branch,
  hasGoals,
  goalsExpanded,
  onToggleGoals,
  onOpenSecrets,
  onOpenSettings,
  onOpenFiles,
  openFilesCount,
  gitChangedFiles,
  gitAhead,
  gitBehind,
  onOpenCommit,
  onOpenSpecs,
}: {
  projectName: string | null
  branch: string | null
  hasGoals: boolean
  goalsExpanded: boolean
  onToggleGoals: () => void
  onOpenSecrets: () => void
  onOpenSettings: () => void
  onOpenFiles: () => void
  openFilesCount: number
  gitChangedFiles: number
  gitAhead: number
  gitBehind: number
  onOpenCommit: () => void
  onOpenSpecs: () => void
}) {
  const hasChanges = gitChangedFiles > 0
  const hasSyncInfo = gitAhead > 0 || gitBehind > 0

  return (
    <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-zinc-200">
          {projectName ?? 'Sneebly Interface'}
        </span>
        {branch && (
          <button
            onClick={onOpenCommit}
            title="Git status"
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <GitBranch className="h-3 w-3" />
            {branch}
            {hasChanges && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            )}
            {hasSyncInfo && (
              <span className="flex items-center gap-0.5 text-zinc-500">
                {gitAhead > 0 && <span>↑{gitAhead}</span>}
                {gitBehind > 0 && <span>↓{gitBehind}</span>}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Settings className="h-3 w-3" />
          Settings
        </button>

        <button
          onClick={onOpenSecrets}
          title="Manage secrets"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <KeyRound className="h-3 w-3" />
          Secrets
        </button>

        <button
          onClick={onOpenSpecs}
          title="Generate specs"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <FileCode className="h-3 w-3" />
          Specs
        </button>

        <button
          onClick={onOpenFiles}
          title="Browse files"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <FolderTree className="h-3 w-3" />
          {openFilesCount > 0 ? `Files (${openFilesCount})` : 'Files'}
        </button>

        {hasGoals && (
          <button
            onClick={onToggleGoals}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            Goals
            {goalsExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function GoalsSummary({
  goals,
}: {
  goals: NonNullable<ReturnType<typeof useProjectStore.getState>['activeProjectGoals']>
}) {
  const currentPhase = goals.phases.find((p) =>
    p.milestones.some((m) => !m.checked)
  ) ?? goals.phases[goals.phases.length - 1]

  const nextMilestones = currentPhase
    ? currentPhase.milestones.filter((m) => !m.checked).slice(0, 3)
    : []

  const stackEntries = Object.entries(goals.techStack).slice(0, 4)

  return (
    <div className="flex flex-wrap gap-6 text-xs text-zinc-400">
      {goals.mission && (
        <div className="max-w-sm">
          <div className="mb-1 text-zinc-500 uppercase tracking-wide text-[10px]">Mission</div>
          <p className="line-clamp-2 text-zinc-300">{goals.mission}</p>
        </div>
      )}

      {stackEntries.length > 0 && (
        <div>
          <div className="mb-1 text-zinc-500 uppercase tracking-wide text-[10px]">Stack</div>
          <div className="flex flex-col gap-0.5">
            {stackEntries.map(([k, v]) => (
              <span key={k}>
                <span className="text-zinc-500">{k}:</span>{' '}
                <span className="text-zinc-300">{v.split('(')[0].trim()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {currentPhase && (
        <div>
          <div className="mb-1 text-zinc-500 uppercase tracking-wide text-[10px]">
            Phase {currentPhase.number}: {currentPhase.name}
          </div>
          <div className="flex flex-col gap-0.5">
            {nextMilestones.length > 0 ? (
              nextMilestones.map((m, i) => (
                <span key={i} className="text-zinc-300">
                  {m.text}
                </span>
              ))
            ) : (
              <span className="text-zinc-600">All milestones complete</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const isHorizontal = orientation === 'horizontal'
  return (
    <Separator
      className={[
        'group flex shrink-0 items-center justify-center bg-zinc-900 transition-colors hover:bg-zinc-800',
        isHorizontal ? 'h-1 w-full cursor-row-resize' : 'h-full w-1 cursor-col-resize',
      ].join(' ')}
    >
      <div
        className={[
          'rounded-full bg-zinc-700 transition-colors group-hover:bg-zinc-500',
          isHorizontal ? 'h-px w-8' : 'h-8 w-px',
        ].join(' ')}
      />
    </Separator>
  )
}
