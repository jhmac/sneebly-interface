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
import SeedFrameNode, { type SeedFrameData, SEED_FRAME_ID } from './SeedFrame'
import { useDesignStore, FRAME_WIDTH, FRAME_HEIGHT } from '../../state/designStore'

// nodeTypes must be stable (module-level) — recreating it on every render
// causes react-flow to unmount and remount all nodes.
const nodeTypes = {
  designFrame: DesignFrameNode,
  seedFrame: SeedFrameNode,
}

// ─── DesignCanvas ─────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  onIterateRequest: (frameId: string) => void
  onImplementRequest: (frameId: string) => void
}

export default function DesignCanvas({ projectId, onIterateRequest, onImplementRequest }: Props) {
  const { currentDesign, seedFrame, moveFrame } = useDesignStore()
  const prevFrameIds = useRef<Set<string>>(new Set())

  // ── User-panning guard ─────────────────────────────────────────────────────
  // If the user has manually panned or zoomed the canvas, suppress auto-refit
  // until 30 s of inactivity has elapsed.
  const userPanningRef = useRef(false)
  const panResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMoveStart = useCallback(() => {
    userPanningRef.current = true
    if (panResetTimerRef.current) clearTimeout(panResetTimerRef.current)
    panResetTimerRef.current = setTimeout(() => {
      userPanningRef.current = false
    }, 30_000)
  }, [])

  useEffect(() => () => {
    if (panResetTimerRef.current) clearTimeout(panResetTimerRef.current)
  }, [])

  // ── Derive nodes and edges from store ──────────────────────────────────────

  // Seed node (if present) is prepended to the node list so it always renders
  // at position {0,0} and is not draggable / selectable like a generated frame.
  const seedNode: Node<SeedFrameData> | null = useMemo(() => {
    if (!seedFrame) return null
    return {
      id: SEED_FRAME_ID,
      type: 'seedFrame',
      position: { x: 0, y: 0 },
      draggable: true,
      selectable: false,
      data: {
        dataUrl: seedFrame.dataUrl,
        capturedAt: seedFrame.capturedAt,
        onIterate: onIterateRequest,
      } satisfies SeedFrameData,
      style: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    }
  }, [seedFrame, onIterateRequest])

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
        onImplement: onImplementRequest,
      } satisfies DesignFrameData,
      style: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    }))
  }, [currentDesign?.frames, projectId, onIterateRequest, onImplementRequest])

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

  // rfNodes holds both DesignFrameData and SeedFrameData nodes.
  // We keep the type as Node<DesignFrameData> for simplicity; the seed node is
  // cast at insertion — react-flow only needs stable ids + positions + type string.
  const castSeed = seedNode as unknown as Node<DesignFrameData>
  const [rfNodes, setRfNodes] = useNodesState<Node<DesignFrameData>>(
    seedNode ? [castSeed, ...storeNodes] : storeNodes
  )
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
      setRfNodes(seedNode ? [castSeed, ...storeNodes] : storeNodes)
      setRfEdges(storeEdges)
      prevFrameIds.current = currentIds
    } else {
      // Only data changed (code resolved, loading toggled) — patch data in-place
      // so react-flow's internal dragged positions are preserved.
      setRfNodes((prev) => {
        const patched = prev.map((rfNode) => {
          // Keep the seed node untouched (its data comes from seedFrame store field)
          if (rfNode.id === SEED_FRAME_ID) {
            return castSeed ?? rfNode
          }
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
              onImplement: onImplementRequest,
            },
          }
        })
        // Inject seed node if it just appeared (wasn't in prev)
        if (seedNode && !prev.some((n) => n.id === SEED_FRAME_ID)) {
          return [castSeed, ...patched]
        }
        // Remove seed node if it was cleared
        if (!seedNode) {
          return patched.filter((n) => n.id !== SEED_FRAME_ID)
        }
        return patched
      })
      setRfEdges(storeEdges)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDesign?.frames, seedFrame])

  // ── Node changes from react-flow (drag, select, etc.) ─────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<DesignFrameData>>[]) => {
      setRfNodes((prev) => applyNodeChanges(changes, prev))
      for (const change of changes) {
        // Write position to store on drag end (dragging === false means drop).
        // Skip the seed node — it is not in DesignState.frames.
        if (
          change.type === 'position' &&
          change.dragging === false &&
          change.position &&
          change.id !== SEED_FRAME_ID
        ) {
          moveFrame(change.id, change.position)
        }
      }
    },
    [setRfNodes, moveFrame]
  )

  // Canvas is "empty" only when there are no frames AND no seed
  const isEmpty = !currentDesign || (currentDesign.frames.length === 0 && !seedFrame)

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
        onMoveStart={handleMoveStart}
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

        {/* Re-fits the viewport whenever the node set or any loading→resolved state changes */}
        <FitViewOnNodeChange nodes={rfNodes} userPanningRef={userPanningRef} />
      </ReactFlow>
    </div>
  )
}

// ─── FitViewOnNodeChange ──────────────────────────────────────────────────────
// Must render inside the ReactFlow provider tree (useReactFlow() requirement).
//
// Fits the viewport whenever either:
//   (a) the set of node IDs changes (frame added / removed), or
//   (b) any frame transitions from loading → resolved (content becomes visible).
//
// Debounced 150 ms so a batch of variants arriving together triggers one fit,
// not one per resolved frame. rAF inside the timer defers until react-flow has
// measured the updated node sizes.
//
// Respects explicit user navigation: if the user has panned or zoomed since the
// last auto-fit, the next auto-fit is skipped until 30 s of inactivity elapses
// (tracked via userPanningRef, set by the parent's onMoveStart handler).

interface FitViewProps {
  nodes: Node<DesignFrameData>[]
  userPanningRef: { current: boolean }
}

function FitViewOnNodeChange({ nodes, userPanningRef }: FitViewProps) {
  const { fitView } = useReactFlow()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Key covers both node-set changes (IDs) and loading→resolved transitions.
  // Sort makes it order-independent so array reordering doesn't trigger spurious fits.
  const stateKey = nodes
    .map((n) => {
      const loading = (n.data as { loading?: boolean }).loading === true
      return `${n.id}:${loading ? 'L' : 'R'}`
    })
    .sort()
    .join(',')

  useEffect(() => {
    if (userPanningRef.current) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      // rAF defers until after react-flow has measured the updated nodes
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }))
    }, 150)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, fitView])

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
