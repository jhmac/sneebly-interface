import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Image, Wrench, ChevronDown, ArrowDown } from 'lucide-react'
import type { ChatMessage } from '../../../shared/types'
import CodeBlock from './CodeBlock'
import { useActivityStore } from '../../state/activityStore'

interface Props {
  messages: ChatMessage[]
  pendingSend: boolean
}

const NEAR_BOTTOM_PX = 80
const PREVIEW_CHARS = 110

export default function MessageList({ messages, pendingSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // atBottom reflects the scroll position *before* new content was appended, so it's the
  // correct signal for whether to follow. showPill is reactive state for the affordance.
  const atBottom = useRef(true)
  const [showPill, setShowPill] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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

  // Jump to the bottom on first mount (MessageList is keyed on session id, so this
  // also fires on session switch).
  useEffect(() => {
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On new content: follow if the user was near the bottom, otherwise surface the pill.
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
            <UserMessage key={msg.id} message={msg} />
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

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {message.attachments.map((a, i) => (
            <AttachmentChip key={i} attachment={a} />
          ))}
        </div>
      )}
      <div className="max-w-[80%] rounded-2xl bg-zinc-700 px-4 py-2.5 text-sm text-zinc-100">
        {message.text}
      </div>
    </div>
  )
}

function AttachmentChip({
  attachment,
}: {
  attachment: NonNullable<ChatMessage['attachments']>[0]
}) {
  const isImage = attachment.kind === 'image' || attachment.kind === 'screenshot'
  return (
    <div className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-400">
      {isImage ? (
        <Image className="h-3 w-3 flex-shrink-0" />
      ) : (
        <FileText className="h-3 w-3 flex-shrink-0" />
      )}
      <span className="max-w-[120px] truncate">{attachment.name}</span>
    </div>
  )
}

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

            if (match || (isBlock && code.includes('\n'))) {
              return <CodeBlock language={match?.[1] ?? 'text'} code={code} />
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {message.text}
      </ReactMarkdown>
    </div>
  )
}
