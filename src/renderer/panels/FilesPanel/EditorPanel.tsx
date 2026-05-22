import React, { useEffect, useRef, useState, Suspense } from 'react'
import {
  X, ExternalLink, FileText, Code2, Braces, Globe, Palette, Terminal, File,
} from 'lucide-react'
import { useEditorStore, type OpenFile } from '../../state/editorStore'
import { useProjectStore } from '../../state/projectStore'

// Lazy-load Monaco to keep initial bundle small
const MonacoEditor = React.lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.Editor }))
)

function getTabIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const cls = 'h-3 w-3 flex-shrink-0'
  switch (ext) {
    case 'md': return <FileText className={`${cls} text-zinc-400`} />
    case 'ts': case 'tsx': return <Code2 className={`${cls} text-blue-400`} />
    case 'js': case 'jsx': return <Code2 className={`${cls} text-yellow-400`} />
    case 'json': return <Braces className={`${cls} text-green-400`} />
    case 'html': return <Globe className={`${cls} text-orange-400`} />
    case 'css': case 'scss': return <Palette className={`${cls} text-pink-400`} />
    case 'py': return <Code2 className={`${cls} text-cyan-400`} />
    case 'go': return <Code2 className={`${cls} text-cyan-300`} />
    case 'sh': case 'bash': return <Terminal className={`${cls} text-zinc-300`} />
    default: return <File className={`${cls} text-zinc-400`} />
  }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

function isEnvFile(path: string): boolean {
  const name = fileName(path)
  return name === '.env' || name.startsWith('.env.')
}

export default function EditorPanel() {
  const { modalOpen, closeModal } = useEditorStore()
  if (!modalOpen) return null
  return <EditorPanelInner onClose={closeModal} />
}

function EditorPanelInner({ onClose }: { onClose: () => void }) {
  const {
    openFilesByProject, activeFilePath, closeFile, setContent, saveFile,
    reloadFile, clearExternalChange, setActiveFilePath,
  } = useEditorStore()
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const projectId = activeProjectId ?? ''
  const openFiles = openFilesByProject[projectId] ?? []
  const activeFile = openFiles.find((f) => f.relativePath === activeFilePath) ?? openFiles[0] ?? null

  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null)
  const [escapeBlocked, setEscapeBlocked] = useState(false)
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
  const prevFilePathRef = useRef<string | null>(null)
  // Refs so the keyboard handler captures latest state without re-registering
  const openFilesRef = useRef(openFiles)
  const activeFileRef = useRef(activeFile)
  openFilesRef.current = openFiles
  activeFileRef.current = activeFile

  const isDirty = (f: OpenFile) => f.editedContent !== f.originalContent

  // Sync editor content when switching tabs (without remounting)
  useEffect(() => {
    if (!editorRef.current || !activeFile) return
    if (prevFilePathRef.current === activeFile.relativePath) return
    prevFilePathRef.current = activeFile.relativePath
    const model = editorRef.current.getModel()
    if (model && model.getValue() !== activeFile.editedContent) {
      model.setValue(activeFile.editedContent)
    }
  }, [activeFile?.relativePath])

  // Keyboard: Escape (close if clean), Cmd+W (close active tab)
  // Uses refs so handler is registered once, not on every keystroke
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const files = openFilesRef.current
      const file = activeFileRef.current
      if (e.key === 'Escape') {
        const hasDirty = files.some(isDirty)
        if (hasDirty) {
          setEscapeBlocked(true)
          setTimeout(() => setEscapeBlocked(false), 2000)
        } else {
          onClose()
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && file) {
        e.preventDefault()
        if (isDirty(file)) {
          setCloseConfirm(file.relativePath)
        } else {
          closeFile(projectId, file.relativePath)
          if (files.length <= 1) onClose()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [projectId, onClose, closeFile])

  function handleMount(
    editor: import('monaco-editor').editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ) {
    editorRef.current = editor
    prevFilePathRef.current = activeFile?.relativePath ?? null

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const current = useEditorStore.getState()
      const files = current.openFilesByProject[projectId] ?? []
      const file = files.find((f) => f.relativePath === current.activeFilePath)
      if (file && activeProject) {
        current.saveFile(activeProject.path, projectId, file.relativePath)
      }
    })

    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
    })
  }

  function handleChange(value: string | undefined) {
    if (activeFile && value !== undefined) {
      setContent(projectId, activeFile.relativePath, value)
    }
  }

  function handleCloseTab(relativePath: string) {
    const file = openFiles.find((f) => f.relativePath === relativePath)
    if (file && isDirty(file)) {
      setCloseConfirm(relativePath)
    } else {
      closeFile(projectId, relativePath)
      if (openFiles.length <= 1) onClose()
    }
  }

  if (openFiles.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        style={{ width: '90vw', height: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tab strip */}
        <div className="flex flex-shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-zinc-950">
          <div className="flex min-w-0 flex-1 items-center">
            {openFiles.map((file) => {
              const isActive = file.relativePath === activeFilePath
              const dirty = isDirty(file)
              return (
                <button
                  key={file.relativePath}
                  onClick={() => setActiveFilePath(file.relativePath)}
                  className={[
                    'group flex flex-shrink-0 items-center gap-1.5 border-r border-zinc-800 px-3 py-2 text-xs transition-colors',
                    isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300',
                  ].join(' ')}
                  style={{ maxWidth: '160px' }}
                >
                  {getTabIcon(file.relativePath)}
                  <span className="truncate">{fileName(file.relativePath)}</span>
                  {dirty && <span className="flex-shrink-0 text-amber-400">•</span>}
                  <span
                    onClick={(e) => { e.stopPropagation(); handleCloseTab(file.relativePath) }}
                    className="ml-0.5 flex-shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
                    role="button"
                    aria-label="Close tab"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              )
            })}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 px-3 py-2 text-zinc-600 hover:text-zinc-400"
            title="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Escape-blocked banner */}
        {escapeBlocked && (
          <div className="flex-shrink-0 border-b border-zinc-700 bg-zinc-800 px-4 py-1.5">
            <p className="text-xs text-zinc-400">You have unsaved changes. Save first or close tabs explicitly.</p>
          </div>
        )}

        {/* Editor area */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {activeFile ? (
            <>
              {/* External change banner */}
              {activeFile.externalChange && (
                <div className="flex flex-shrink-0 items-center justify-between border-b border-yellow-800/50 bg-yellow-950/50 px-4 py-2">
                  <p className="text-xs text-yellow-300">
                    Claude edited this file on disk. Your unsaved changes will overwrite Claude's edits if you save.
                  </p>
                  <div className="flex flex-shrink-0 gap-2 ml-4">
                    <button
                      onClick={() => activeProject && reloadFile(activeProject.path, projectId, activeFile.relativePath)}
                      className="rounded bg-yellow-700 px-2 py-1 text-xs font-medium text-white hover:bg-yellow-600 transition-colors"
                    >
                      Reload from disk
                    </button>
                    <button
                      onClick={() => clearExternalChange(projectId, activeFile.relativePath)}
                      className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Keep my changes
                    </button>
                  </div>
                </div>
              )}

              {/* .env warning banner */}
              {isEnvFile(activeFile.relativePath) && (
                <div className="flex-shrink-0 border-b border-yellow-900/40 bg-yellow-950/20 px-4 py-1.5">
                  <p className="text-[11px] text-yellow-500/80">
                    This file may contain secrets. Be careful sharing screenshots.
                  </p>
                </div>
              )}

              {activeFile.isBinary ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-zinc-600">Binary file — cannot display</p>
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <p className="text-xs text-zinc-600">Loading editor…</p>
                    </div>
                  }
                >
                  <MonacoEditor
                    height="100%"
                    language={activeFile.language}
                    defaultValue={activeFile.editedContent}
                    theme="vs-dark"
                    onChange={handleChange}
                    onMount={handleMount}
                    options={{
                      fontSize: 13,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      readOnly: activeFile.isBinary,
                      wordWrap: 'off',
                      tabSize: 2,
                      automaticLayout: true,
                    }}
                  />
                </Suspense>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-600">No file selected</p>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex h-7 flex-shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-500">
          <div className="flex items-center gap-4">
            <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
            <span>Spaces: 2</span>
            {activeFile && <span>{activeFile.language}</span>}
          </div>
          <div className="flex items-center gap-3">
            {activeFile && isDirty(activeFile) ? (
              <span className="text-amber-400">Modified</span>
            ) : (
              <span>Saved</span>
            )}
            <span className="text-zinc-600">⌘S</span>
            {activeFile && (
              <button
                onClick={() => window.api.shellOpenExternal(`file://${activeFile.absolutePath}`)}
                title="Open in external editor"
                className="hover:text-zinc-300 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Close-dirty-tab confirm dialog */}
      {closeConfirm && (
        <CloseTabConfirm
          fileName={fileName(closeConfirm)}
          onSave={async () => {
            if (activeProject) await saveFile(activeProject.path, projectId, closeConfirm)
            closeFile(projectId, closeConfirm)
            setCloseConfirm(null)
            if (openFiles.length <= 1) onClose()
          }}
          onDiscard={() => {
            closeFile(projectId, closeConfirm)
            setCloseConfirm(null)
            if (openFiles.length <= 1) onClose()
          }}
          onCancel={() => setCloseConfirm(null)}
        />
      )}
    </div>
  )
}

function CloseTabConfirm({
  fileName,
  onSave,
  onDiscard,
  onCancel,
}: {
  fileName: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60">
      <div className="flex w-80 flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <p className="text-sm text-zinc-200">
          Discard unsaved changes in <span className="font-medium text-zinc-100">{fileName}</span>?
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Discard & close
          </button>
          <button
            onClick={onSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            Save & close
          </button>
        </div>
      </div>
    </div>
  )
}
