import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type KeyboardEvent,
  type DragEvent,
  type ClipboardEvent,
} from 'react'
import { Paperclip, Camera, ImageIcon, X, FileText, Image } from 'lucide-react'
import { useChatStore } from '../../state/chatStore'
import { useProjectStore } from '../../state/projectStore'
import type { PendingAttachment } from '../../../shared/types'
import { basename } from '../../../shared/utils'
import { buildSetupPrompt } from '../../../shared/setup-prompt'

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: 'Clear the current session' },
  { cmd: '/checkpoint', desc: 'Mark a checkpoint in the conversation' },
  { cmd: '/goals', desc: 'Inject project goals into the message' },
  { cmd: '/setup', desc: 'Ask Claude to provision this project locally' },
]

export default function Composer() {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashIdx, setSlashIdx] = useState(0)
  const [atOpen, setAtOpen] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atIdx, setAtIdx] = useState(0)
  const [projectFiles, setProjectFiles] = useState<string[]>([])

  const { composerText, composerAttachments, pendingSend, setComposerText,
    addAttachment, removeAttachment, sendMessage, clearCurrentSession } = useChatStore()
  const { activeProjectId, projects, activeProjectGoals } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 24 * 10
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [composerText])

  // Load project files once for @-picker
  useEffect(() => {
    if (!activeProject) return
    window.api.fsListProjectFiles(activeProject.path).then(setProjectFiles).catch(() => {})
  }, [activeProject?.path])

  // Slash command detection
  useEffect(() => {
    const open = composerText.startsWith('/')
    setSlashOpen(open)
    if (!open) setSlashIdx(0)
  }, [composerText])

  // @-mention detection
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const q = getAtQuery(composerText, pos)
    setAtOpen(q !== null)
    setAtQuery(q ?? '')
    if (q === null) setAtIdx(0)
  }, [composerText])

  const filteredSlash = SLASH_COMMANDS.filter((c) =>
    c.cmd.includes(composerText.split(' ')[0])
  )

  const filteredFiles = projectFiles
    .filter((f) => f.toLowerCase().includes(atQuery.toLowerCase()))
    .slice(0, 20)

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter sends
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
      return
    }

    // Slash command menu navigation
    if (slashOpen && filteredSlash.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => (i + 1) % filteredSlash.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIdx((i) => (i - 1 + filteredSlash.length) % filteredSlash.length); return }
      if (e.key === 'Enter')     { e.preventDefault(); selectSlashCommand(filteredSlash[slashIdx].cmd); return }
      if (e.key === 'Escape')    { setSlashOpen(false); return }
    }

    // @-mention menu navigation
    if (atOpen && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtIdx((i) => (i + 1) % filteredFiles.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAtIdx((i) => (i - 1 + filteredFiles.length) % filteredFiles.length); return }
      if (e.key === 'Enter')     { e.preventDefault(); insertAtMention(filteredFiles[atIdx]); return }
      if (e.key === 'Escape')    { setAtOpen(false); return }
    }
  }

  function selectSlashCommand(cmd: string) {
    setSlashOpen(false)
    if (cmd === '/clear') {
      setComposerText('')
      clearCurrentSession()
    } else if (cmd === '/checkpoint') {
      setComposerText('')
      // Phase 5 will wire this up; for now just clear
    } else if (cmd === '/goals') {
      const goals = activeProjectGoals
      if (!goals) { setComposerText(''); return }
      const summary = [
        goals.mission ? `Mission: ${goals.mission}` : '',
        Object.entries(goals.techStack).length
          ? `Stack: ${Object.entries(goals.techStack).map(([k, v]) => `${k}: ${v}`).join(', ')}`
          : '',
      ].filter(Boolean).join('\n')
      setComposerText(summary + '\n\n')
      textareaRef.current?.focus()
    } else if (cmd === '/setup') {
      const prompt = buildSetupPrompt(activeProject?.name ?? 'this project')
      setComposerText(prompt)
      setTimeout(() => {
        const el = textareaRef.current
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length }
      })
    }
  }

  function insertAtMention(file: string) {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const q = getAtQuery(composerText, pos)
    if (q === null) return
    const atPos = pos - q.length - 1
    const next = composerText.slice(0, atPos) + `@${file}` + composerText.slice(pos)
    setComposerText(next)
    setAtOpen(false)
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = atPos + file.length + 1
    })
  }

  function handleSend() {
    if (pendingSend || !composerText.trim()) return
    sendMessage()
    textareaRef.current?.focus()
  }

  // Clipboard paste (images)
  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!activeProject) return
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith('image/')
    )
    if (!item) return
    e.preventDefault()
    const file = item.getAsFile()
    if (!file) return
    const buf = await file.arrayBuffer()
    const fileName = `paste-${crypto.randomUUID()}.png`
    const savedPath = await window.api.fsSaveAttachment(
      activeProject.path, fileName, new Uint8Array(buf)
    )
    addAttachment({
      id: crypto.randomUUID(),
      kind: 'image',
      path: savedPath,
      name: fileName,
      thumbnailUrl: `file://${savedPath}`,
    })
  }

  // Drag + drop files
  function handleDragOver(e: DragEvent) { e.preventDefault(); setDragOver(true) }
  function handleDragLeave()            { setDragOver(false) }
  function handleDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false)
    Array.from(e.dataTransfer.files).forEach((file) => {
      const path = (file as File & { path?: string }).path ?? file.name
      addAttachment({ id: crypto.randomUUID(), kind: 'file', path, name: file.name })
    })
  }

  // Toolbar actions
  async function handleAttachFile() {
    const paths = await window.api.fsShowOpenDialog()
    paths.forEach((p) => addAttachment({ id: crypto.randomUUID(), kind: 'file', path: p, name: basename(p) }))
  }

  async function handleScreenshot() {
    if (!activeProject) return
    const savedPath = await window.api.systemTakeScreenshot(activeProject.path)
    if (!savedPath) return
    const name = basename(savedPath)
    addAttachment({ id: crypto.randomUUID(), kind: 'screenshot', path: savedPath, name, thumbnailUrl: `file://${savedPath}` })
  }

  async function handleClipboardImage() {
    if (!activeProject) return
    try {
      const [item] = await navigator.clipboard.read()
      if (!item.types.includes('image/png')) return
      const blob = await item.getType('image/png')
      const buf = await blob.arrayBuffer()
      const fileName = `clipboard-${crypto.randomUUID()}.png`
      const savedPath = await window.api.fsSaveAttachment(activeProject.path, fileName, new Uint8Array(buf))
      addAttachment({ id: crypto.randomUUID(), kind: 'image', path: savedPath, name: fileName, thumbnailUrl: `file://${savedPath}` })
    } catch { /* user denied or no image */ }
  }

  return (
    <div
      className={[
        'flex flex-shrink-0 flex-col border-t border-zinc-800 bg-zinc-900 transition-colors',
        dragOver ? 'border-zinc-500 bg-zinc-800' : '',
      ].join(' ')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Slash command menu */}
      {slashOpen && filteredSlash.length > 0 && (
        <div className="mx-3 mb-1 rounded-lg border border-zinc-700 bg-zinc-800 shadow-lg">
          {filteredSlash.map((c, i) => (
            <button
              key={c.cmd}
              onClick={() => selectSlashCommand(c.cmd)}
              className={[
                'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                i === slashIdx ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/60',
              ].join(' ')}
            >
              <span className="font-mono text-zinc-300">{c.cmd}</span>
              <span className="text-xs text-zinc-500">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* @file picker */}
      {atOpen && filteredFiles.length > 0 && (
        <div className="mx-3 mb-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-lg">
          {filteredFiles.map((f, i) => (
            <button
              key={f}
              onClick={() => insertAtMention(f)}
              className={[
                'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                i === atIdx ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/60',
              ].join(' ')}
            >
              <FileText className="h-3 w-3 flex-shrink-0" />
              <span className="truncate font-mono">{f}</span>
            </button>
          ))}
        </div>
      )}

      {/* Attachment chips */}
      {composerAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {composerAttachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={composerText}
        onChange={(e) => setComposerText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Message… (Cmd+Enter to send)"
        disabled={pendingSend}
        rows={1}
        className="w-full resize-none bg-transparent px-3 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none disabled:opacity-50"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 pb-2">
        <ToolbarBtn onClick={handleAttachFile} title="Attach file">
          <Paperclip className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={handleScreenshot} title="Take screenshot">
          <Camera className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={handleClipboardImage} title="Paste from clipboard">
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-700">⌘↵ send</span>
      </div>
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment
  onRemove: () => void
}) {
  const isImage = attachment.kind === 'image' || attachment.kind === 'screenshot'
  return (
    <div className="flex items-center gap-1 rounded-md bg-zinc-800 pl-1.5 pr-1 py-1 text-xs text-zinc-400">
      {attachment.thumbnailUrl ? (
        <img src={attachment.thumbnailUrl} alt="" className="h-5 w-5 rounded object-cover" />
      ) : isImage ? (
        <Image className="h-3.5 w-3.5" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      <span className="max-w-[100px] truncate">{attachment.name}</span>
      <button onClick={onRemove} className="ml-0.5 rounded text-zinc-600 hover:text-zinc-400">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function ToolbarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
    >
      {children}
    </button>
  )
}

function getAtQuery(text: string, cursor: number): string | null {
  let i = cursor - 1
  while (i >= 0 && text[i] !== ' ' && text[i] !== '\n') {
    if (text[i] === '@') return text.slice(i + 1, cursor)
    i--
  }
  return null
}
