import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  BackgroundVariant,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import DesignFrameNode, { type DesignFrameData } from './DesignFrame'
import { useDesignStore, FRAME_WIDTH, FRAME_HEIGHT } from '../../state/designStore'

// nodeTypes must be stable (module-level) — recreating it on every render
// causes react-flow to unmount and remount all nodes.
const nodeTypes = { designFrame: DesignFrameNode }

// ─── DesignCanvas ─────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  onIterateRequest: (frameId: string) => void
}

export default function DesignCanvas({ projectId, onIterateRequest }: Props) {
  const { currentDesign, moveFrame } = useDesignStore()
  const prevFrameIds = useRef<Set<string>>(new Set())

  // ── Derive nodes and edges from store ──────────────────────────────────────

  const storeNodes: Node<DesignFrameData>[] = useMemo(() => {
    if (!currentDesign) return []
    return currentDesign.frames.map((frame) => ({
      id: frame.id,
      type: 'designFrame',
      position: frame.position,
      draggable: !frame.loading,
      data: {
        frameId: frame.id,
        projectId,
        code: frame.code,
        kind: frame.kind,
        prompt: frame.prompt,
        parentFrameId: frame.parentFrameId,
        generatedAt: frame.generatedAt,
        loading: frame.loading,
        error: frame.error,
        generationId: frame.generationId,
        onIterate: onIterateRequest,
      } satisfies DesignFrameData,
      style: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    }))
  }, [currentDesign?.frames, projectId, onIterateRequest])

  const storeEdges: Edge[] = useMemo(() => {
    if (!currentDesign) return []
    return currentDesign.frames
      .filter((f) => f.parentFrameId)
      .map((f) => ({
        id: `e-${f.parentFrameId}-${f.id}`,
        source: f.parentFrameId!,
        target: f.id,
        type: 'smoothstep',
        style: { stroke: '#52525b', strokeWidth: 1.5 },
        animated: false,
        selectable: false,
      }))
  }, [currentDesign?.frames])

  const [rfNodes, setRfNodes] = useNodesState(storeNodes)
  const [rfEdges, setRfEdges] = useEdgesState(storeEdges)

  // ── Sync store → react-flow ────────────────────────────────────────────────
  // Full sync only when frame set changes (add/remove frames).
  // For data-only changes (loading → resolved), update node data in-place so
  // user-dragged positions aren't reset by the incoming store state.

  useEffect(() => {
    const currentIds = new Set(currentDesign?.frames.map((f) => f.id) ?? [])
    const prevIds = prevFrameIds.current
    const setChanged =
      currentIds.size !== prevIds.size ||
      [...currentIds].some((id) => !prevIds.has(id))

    if (setChanged) {
      // Frame added or removed — full sync (positions come from the store)
      setRfNodes(storeNodes)
      setRfEdges(storeEdges)
      prevFrameIds.current = currentIds
    } else {
      // Only data changed (code resolved, loading toggled) — patch data in-place
      // so react-flow's internal dragged positions are preserved.
      setRfNodes((prev) =>
        prev.map((rfNode) => {
          const frame = currentDesign?.frames.find((f) => f.id === rfNode.id)
          if (!frame) return rfNode
          return {
            ...rfNode,   // ← preserves rfNode.position from any prior drag
            draggable: !frame.loading,
            data: {
              ...rfNode.data,
              code: frame.code,
              kind: frame.kind,
              loading: frame.loading,
              error: frame.error,
              generationId: frame.generationId,
              onIterate: onIterateRequest,
            },
          }
        })
      )
      setRfEdges(storeEdges)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDesign?.frames])

  // ── Node changes from react-flow (drag, select, etc.) ─────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<DesignFrameData>>[]) => {
      setRfNodes((prev) => applyNodeChanges(changes, prev))
      for (const change of changes) {
        // Write position to store on drag end (dragging === false means drop)
        if (change.type === 'position' && change.dragging === false && change.position) {
          moveFrame(change.id, change.position)
        }
      }
    },
    [setRfNodes, moveFrame]
  )

  const isEmpty = !currentDesign || currentDesign.frames.length === 0

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={2}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#3f3f46"
        />
        <Controls
          style={{ background: '#18181b', border: '1px solid #3f3f46' }}
          showInteractive={false}
        />
        <MiniMap
          style={{ background: '#18181b', border: '1px solid #3f3f46' }}
          nodeColor="#3f3f46"
          maskColor="rgba(9, 9, 11, 0.7)"
          position="top-right"
        />

        {isEmpty && <EmptyState />}

        {/* Fits the viewport to the first batch of frames when they arrive */}
        <FitViewOnFirstFrames frameCount={currentDesign?.frames.length ?? 0} />
      </ReactFlow>
    </div>
  )
}

// ─── FitViewOnFirstFrames ─────────────────────────────────────────────────────
// useReactFlow() must be called inside the ReactFlow provider tree.
// This component watches frame count and fits the viewport once when the first
// frame finishes loading — giving the user a good initial view.

function FitViewOnFirstFrames({ frameCount }: { frameCount: number }) {
  const { fitView } = useReactFlow()
  const prevCount = useRef(0)

  useEffect(() => {
    // Only trigger on the transition from 0 frames → first completed frame(s)
    if (prevCount.current === 0 && frameCount > 0) {
      // rAF defers until after react-flow has measured the new nodes
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }))
    }
    prevCount.current = frameCount
  }, [frameCount, fitView])

  return null
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3"
      style={{ zIndex: 10 }}
    >
      <p className="text-sm font-medium text-zinc-500">No frames yet</p>
      <p className="text-xs text-zinc-600">Type a prompt below and click Generate</p>
    </div>
  )
}
