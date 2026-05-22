import { useEffect } from 'react'
import { X, Copy, ExternalLink } from 'lucide-react'
import { useFilesStore } from '../../state/filesStore'
import CodeBlock from '../ChatPanel/CodeBlock'

function formatRelative(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(mtimeMs).toLocaleDateString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function extToLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx',
    js: 'javascript', jsx: 'jsx',
    json: 'json', md: 'markdown',
    py: 'python', go: 'go',
    css: 'css', scss: 'css',
    html: 'html', sh: 'bash', bash: 'bash',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml', sql: 'sql', rs: 'rust',
  }
  return map[ext] ?? 'text'
}

export default function FileViewer() {
  const { viewerOpen, viewerFile, closeViewer } = useFilesStore()

  // Capture-phase handler so Escape closes viewer before panel's bubble handler fires
  useEffect(() => {
    if (!viewerOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeViewer()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [viewerOpen, closeViewer])

  if (!viewerOpen || !viewerFile) return null

  const { path, absolutePath, data } = viewerFile

  async function copyContents() {
    if (!data.isBinary) {
      await navigator.clipboard.writeText(data.content)
    }
  }

  function openInEditor() {
    window.api.shellOpenExternal(`file://${absolutePath}`)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) closeViewer() }}
    >
      <div
        className="flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        style={{ width: '80vw', height: '80vh' }}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate font-mono text-xs text-zinc-300" title={path}>
              {path}
            </span>
            <span className="flex-shrink-0 text-xs text-zinc-600">{formatSize(data.sizeBytes)}</span>
            <span className="flex-shrink-0 text-xs text-zinc-600">{formatRelative(data.mtime)}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {!data.isBinary && (
              <button
                onClick={copyContents}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Copy className="h-3 w-3" />
                Copy contents
              </button>
            )}
            <button
              onClick={openInEditor}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <ExternalLink className="h-3 w-3" />
              Open in editor
            </button>
            <button
              onClick={closeViewer}
              className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {data.isBinary ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-600">Binary file — cannot display</p>
            </div>
          ) : (
            <>
              {data.truncated && (
                <div className="border-b border-yellow-900/50 bg-yellow-950/30 px-4 py-2">
                  <p className="text-xs text-yellow-400">Showing first 1MB. File is larger.</p>
                </div>
              )}
              <CodeBlock language={extToLanguage(path)} code={data.content} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
