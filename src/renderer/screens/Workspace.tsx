import { useEffect, useRef } from 'react'
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
} from 'react-resizable-panels'
import type { LayoutSizes } from '../../shared/types'

const DEFAULT_SIZES: LayoutSizes = {
  vertical: { preview: 55, bottom: 45 },
  horizontal: { chat: 50, activity: 50 },
}

export default function Workspace() {
  const verticalRef = useGroupRef()
  const horizontalRef = useGroupRef()
  const sizesRef = useRef<LayoutSizes>(DEFAULT_SIZES)

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
    <div className="h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
      <Group
        groupRef={verticalRef}
        orientation="vertical"
        defaultLayout={DEFAULT_SIZES.vertical}
        onLayoutChanged={handleVerticalLayout}
        className="h-full"
      >
        <Panel id="preview" defaultSize={55} minSize={20}>
          <PlaceholderPanel label="Preview goes here" />
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
      orientation={orientation}
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
