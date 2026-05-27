import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Wrench, ChevronDown, ArrowDown, X } from 'lucide-react'
import type { ChatMessage } from '../../../shared/types'
import CodeBlock from './CodeBlock'
import ArtifactBlock from './ArtifactBlock'
import { useActivityStore } from '../../state/activityStore'
import type { ArtifactKind } from '../../../shared/types'

interface Props {
  messages: ChatMessage[]
  pendingSend: boolean
}

const NEAR_BOTTOM_PX = 80
const PREVIEW_CHARS = 110

// Artifact rendering — minimum source chars before we render a live preview
const ARTIFACT_MIN_CHARS = 100
const ARTIFACT_LANG_MAP: Record<string, ArtifactKind> = {
  html:    'html',
  jsx:     'react',
  tsx:     'react',
  svg:     'svg',
  mermaid: 'mermaid',
}

type Attachment = NonNullable<ChatMessage['attachments']>[0]

// ─── MessageList ─────────────────────────────────────────────────────────────

export default function MessageList({ messages, pendingSend }: Props) {
  const bottomRef   = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottom    = useRef(true)
  const [showPill, setShowPill]   = useState(false)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; name: string } | null>(null)

  // Stable callbacks — avoid re-rendering every image on each parent update
  const openLightbox  = useCallback((src: string, name: string) => setLightboxSrc({ src, name }), [])
  const closeLightbox = useCallback(() => setLightboxSrc(null), [])

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    atBottom.current = nearBottom
    if (nearBottom && showPill) setShowPill(false)
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    bottomRef.current?.scrollIntoView({ behavior })
    atBottom.current = true
    setShowPill(false)
  }

  // Jump to bottom on mount / session switch (MessageList is keyed on session id)
  useEffect(() => {
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow new content if the user was near the bottom; otherwise surface the pill
  useEffect(() => {
    if (atBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setShowPill(true)
    }
  }, [messages, pendingSend])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
        Start a conversation
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserMessage key={msg.id} message={msg} onLightbox={openLightbox} />
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              collapsed={msg.id !== lastAssistantId && !expanded.has(msg.id)}
              onExpand={() => setExpanded((s) => new Set(s).add(msg.id))}
            />
          )
        )}
        {pendingSend && <WorkingPill />}
        <div ref={bottomRef} />
      </div>

      {/* Lightbox — fixed overlay, above everything in the app */}
      {lightboxSrc && (
        <LightboxOverlay
          src={lightboxSrc.src}
          name={lightboxSrc.name}
          onClose={closeLightbox}
        />
      )}

      {showPill && (
        <button
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-full bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 shadow-lg transition-colors hover:bg-zinc-600"
        >
          <ArrowDown className="h-3 w-3" />
          New messages
        </button>
      )}
    </div>
  )
}

// ─── UserMessage ──────────────────────────────────────────────────────────────

function UserMessage({
  message,
  onLightbox,
}: {
  message: ChatMessage
  onLightbox: (src: string, name: string) => void
}) {
  const imageAttachments = message.attachments?.filter(
    (a) => a.kind === 'image' || a.kind === 'screenshot'
  ) ?? []
  const fileAttachments = message.attachments?.filter(
    (a) => a.kind !== 'image' && a.kind !== 'screenshot'
  ) ?? []

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Image thumbnails — above the text bubble */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {imageAttachments.map((a, i) => (
            <ImageThumb key={i} attachment={a} onLightbox={onLightbox} />
          ))}
        </div>
      )}
      {/* Text bubble */}
      <div className="max-w-[80%] rounded-2xl bg-zinc-700 px-4 py-2.5 text-sm text-zinc-100">
        {message.text}
      </div>
      {/* Non-image file chips */}
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {fileAttachments.map((a, i) => (
            <FileChip key={i} attachment={a} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ImageThumb ───────────────────────────────────────────────────────────────

function ImageThumb({
  attachment,
  onLightbox,
}: {
  attachment: Attachment
  onLightbox: (src: string, name: string) => void
}) {
  const [imgError, setImgError] = useState(false)
  const src = `file://${attachment.path}`

  // File missing or unreadable — degrade to a named chip so context isn't lost
  if (imgError) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-500">
        <FileText className="h-3 w-3 flex-shrink-0" />
        <span className="max-w-[140px] truncate">{attachment.name}</span>
      </div>
    )
  }

  return (
    <button
      draggable
      onDragStart={(e) => {
        // Custom type lets Composer re-attach the image on drop
        e.dataTransfer.setData('application/sneebly-image-path', attachment.path)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onLightbox(src, attachment.name)}
      title={`${attachment.name} — click to enlarge · drag to re-use`}
      className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800 transition-colors hover:border-zinc-500 cursor-zoom-in"
    >
      <img
        src={src}
        alt={attachment.name}
        className="block max-h-64 max-w-xs object-contain"
        onError={() => setImgError(true)}
      />
    </button>
  )
}

// ─── FileChip ─────────────────────────────────────────────────────────────────

function FileChip({ attachment }: { attachment: Attachment }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-400">
      <FileText className="h-3 w-3 flex-shrink-0" />
      <span className="max-w-[120px] truncate">{attachment.name}</span>
    </div>
  )
}

// ─── LightboxOverlay ─────────────────────────────────────────────────────────

function LightboxOverlay({
  src,
  name,
  onClose,
}: {
  src: string
  name: string
  onClose: () => void
}) {
  // Ref keeps the Esc handler stable across renders without re-subscribing
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // empty deps — always reads latest via ref

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Stop clicks on the image itself from closing the overlay */}
      <div
        className="relative flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={name}
          className="block max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        />
        <span className="max-w-[60vw] truncate text-center text-xs text-zinc-500">{name}</span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 shadow-lg transition-colors hover:bg-zinc-500 hover:text-zinc-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── WorkingPill ──────────────────────────────────────────────────────────────

function WorkingPill() {
  const toolCallCount = useActivityStore((s) => s.currentTurn?.toolCallCount ?? 0)
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        <Wrench className="h-3 w-3 animate-spin" />
        {toolCallCount > 0
          ? `Claude is working — ${toolCallCount} tool call${toolCallCount !== 1 ? 's' : ''}`
          : 'Claude is working…'}
      </div>
    </div>
  )
}

// ─── AssistantMessage ─────────────────────────────────────────────────────────

// Reduce an assistant turn to a single muted line for the collapsed state.
function previewText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n').length
    return `<code block: ${lines} lines>`
  }
  const stripped = trimmed
    .replace(/```[\s\S]*?```/g, ' <code> ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return '<no text>'
  return stripped.length > PREVIEW_CHARS ? stripped.slice(0, PREVIEW_CHARS) + '…' : stripped
}

function AssistantMessage({
  message,
  collapsed,
  onExpand,
}: {
  message: ChatMessage
  collapsed: boolean
  onExpand: () => void
}) {
  if (collapsed) {
    return (
      <button
        onClick={onExpand}
        className="group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-400"
      >
        <span className="min-w-0 flex-1 truncate">{previewText(message.text)}</span>
        <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }
  return (
    <div className="prose prose-invert prose-sm max-w-none text-zinc-200 [&_a]:text-blue-400 [&_a]:no-underline hover:[&_a]:underline [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-zinc-300 [&_pre]:bg-transparent [&_pre]:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const isBlock = !props.ref // block code has no inline marker
            const code = String(children).replace(/\n$/, '')

            // Live artifact rendering for HTML / React / SVG / Mermaid blocks
            if (match && isBlock && code.length >= ARTIFACT_MIN_CHARS) {
              const artifactKind = ARTIFACT_LANG_MAP[match[1].toLowerCase()]
              if (artifactKind) {
                return <ArtifactBlock kind={artifactKind} code={code} />
              }
            }

            if (match || (isBlock && code.includes('\n'))) {
              return <CodeBlock language={match?.[1] ?? 'text'} code={code} />
            }
            return <code className={className} {...props}>{children}</code>
          },
        }}
      >
        {message.text}
      </ReactMarkdown>
    </div>
  )
}
