import { useEffect, useRef } from 'react'
import {
  RotateCw, Search, X,
  ChevronRight, ChevronDown,
  Folder, FolderOpen,
  FileText, Code2, Braces, Globe, Palette, Terminal, File,
} from 'lucide-react'
import { useFilesStore } from '../../state/filesStore'
import { useEditorStore } from '../../state/editorStore'
import { useProjectStore } from '../../state/projectStore'
import type { TreeNode } from '../../../shared/types'

function countFiles(nodes: TreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.kind === 'file') count++
    else if (node.children) count += countFiles(node.children)
  }
  return count
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.toLowerCase()
  return nodes.flatMap((node) => {
    if (node.kind === 'file') {
      return node.name.toLowerCase().includes(q) ? [node] : []
    }
    const filteredChildren = filterTree(node.children ?? [], q)
    if (filteredChildren.length > 0) return [{ ...node, children: filteredChildren }]
    if (node.name.toLowerCase().includes(q)) return [{ ...node, children: [] }]
    return []
  })
}

export default function FilesTree() {
  const { tree, expandedPaths, searchQuery, loading, toggleExpand, setSearchQuery, loadTree } =
    useFilesStore()
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!activeProject) return
    loadTree(activeProject.path, activeProject.id)
  }, [activeProject?.id])

  function openFile(relativePath: string) {
    if (!activeProject) return
    const store = useEditorStore.getState()
    store.openFile(activeProject.path, activeProject.id, relativePath)
    store.openModal()
  }

  const displayTree = searchQuery ? filterTree(tree ?? [], searchQuery) : (tree ?? [])
  const fileCount = tree ? countFiles(tree) : 0

  return (
    <div className="flex h-full flex-col">
      {/* Tree header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">
          {activeProject?.name ?? 'No project'}
        </span>
        <button
          onClick={() => activeProject && useFilesStore.getState().resetForProject() && loadTree(activeProject.path, activeProject.id)}
          title="Refresh tree"
          className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
        >
          <RotateCw className="h-3 w-3" />
        </button>
      </div>

      {/* Large project warning */}
      {fileCount > 5000 && (
        <div className="flex-shrink-0 border-b border-yellow-900/50 bg-yellow-950/30 px-3 py-1.5">
          <p className="text-[10px] text-yellow-400">
            Large project — search may be slow.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="flex-shrink-0 border-b border-zinc-800 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1">
          <Search className="h-3 w-3 flex-shrink-0 text-zinc-500" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files…"
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-zinc-600 hover:text-zinc-400">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tree body */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center py-6">
            <p className="text-xs text-zinc-600">Loading…</p>
          </div>
        )}
        {!loading && displayTree.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <p className="text-xs text-zinc-600">
              {searchQuery ? 'No matching files' : 'No files'}
            </p>
          </div>
        )}
        {!loading && displayTree.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            expandedPaths={expandedPaths}
            onToggle={toggleExpand}
            onOpenFile={openFile}
            selectedPath={activeFilePath}
            searchActive={!!searchQuery}
          />
        ))}
      </div>
    </div>
  )
}

function getFileIcon(name: string, kind: 'dir' | 'file', expanded?: boolean) {
  if (kind === 'dir') {
    return expanded
      ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
      : <Folder className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'md': return <FileText className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
    case 'ts': case 'tsx': return <Code2 className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
    case 'js': case 'jsx': return <Code2 className="h-3.5 w-3.5 flex-shrink-0 text-yellow-400" />
    case 'json': return <Braces className="h-3.5 w-3.5 flex-shrink-0 text-green-400" />
    case 'html': return <Globe className="h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
    case 'css': case 'scss': return <Palette className="h-3.5 w-3.5 flex-shrink-0 text-pink-400" />
    case 'py': return <Code2 className="h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
    case 'go': return <Code2 className="h-3.5 w-3.5 flex-shrink-0 text-cyan-300" />
    case 'sh': case 'bash': return <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-zinc-300" />
    default: return <File className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
  }
}

function TreeNodeRow({
  node, depth, expandedPaths, onToggle, onOpenFile, selectedPath, searchActive,
}: {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  selectedPath: string | null
  searchActive: boolean
}) {
  const isExpanded = searchActive || expandedPaths.has(node.path)
  const isSelected = selectedPath === node.path
  const isDir = node.kind === 'dir'

  return (
    <>
      <div
        className={[
          'flex cursor-pointer select-none items-center gap-1.5 py-0.5 pr-2',
          isSelected
            ? 'bg-zinc-700/60 text-zinc-100'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
        ].join(' ')}
        style={{ paddingLeft: `${6 + depth * 10}px` }}
        onClick={() => (isDir ? onToggle(node.path) : onOpenFile(node.path))}
      >
        {isDir ? (
          isExpanded
            ? <ChevronDown className="h-3 w-3 flex-shrink-0 text-zinc-600" />
            : <ChevronRight className="h-3 w-3 flex-shrink-0 text-zinc-600" />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {getFileIcon(node.name, node.kind, isExpanded)}
        <span className="truncate text-xs">{node.name}</span>
      </div>
      {isDir && isExpanded && node.children?.map((child) => (
        <TreeNodeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          selectedPath={selectedPath}
          searchActive={searchActive}
        />
      ))}
    </>
  )
}
