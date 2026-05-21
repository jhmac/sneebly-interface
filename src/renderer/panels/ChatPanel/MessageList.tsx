import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Image, Wrench } from 'lucide-react'
import type { ChatMessage } from '../../../shared/types'
import CodeBlock from './CodeBlock'
import { useActivityStore } from '../../state/activityStore'

interface Props {
  messages: ChatMessage[]
  pendingSend: boolean
}

export default function MessageList({ messages, pendingSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  useEffect(() => {
    if (atBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
    >
      {messages.map((msg) =>
        msg.role === 'user' ? (
          <UserMessage key={msg.id} message={msg} />
        ) : (
          <AssistantMessage key={msg.id} message={msg} />
        )
      )}
      {pendingSend && <WorkingPill />}
      <div ref={bottomRef} />
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

function AssistantMessage({ message }: { message: ChatMessage }) {
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
