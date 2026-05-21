import { useEffect, useRef } from 'react'
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
} from 'react-resizable-panels'
import { GitBranch, ChevronDown, ChevronUp } from 'lucide-react'
import type { LayoutSizes } from '../../shared/types'
import { useProjectStore } from '../state/projectStore'
import PreviewPanel from '../panels/PreviewPanel'

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
  } = useProjectStore()

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-900 text-zinc-100">
      {/* Workspace header */}
      <WorkspaceHeader
        projectName={activeProject?.name ?? null}
        branch={activeProjectBranch}
        hasGoals={activeProjectGoals !== null}
        goalsExpanded={goalsExpanded}
        onToggleGoals={() => setGoalsExpanded(!goalsExpanded)}
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
                <PlaceholderPanel label="Chat" />
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel id="activity" defaultSize={50} minSize={20}>
                <PlaceholderPanel label="Activity" />
              </Panel>
            </Group>
          </Panel>
        </Group>
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
}: {
  projectName: string | null
  branch: string | null
  hasGoals: boolean
  goalsExpanded: boolean
  onToggleGoals: () => void
}) {
  return (
    <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-zinc-200">
          {projectName ?? 'Sneebly Interface'}
        </span>
        {branch && (
          <span className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            <GitBranch className="h-3 w-3" />
            {branch}
          </span>
        )}
      </div>

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

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="text-sm text-zinc-600">{label}</span>
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
