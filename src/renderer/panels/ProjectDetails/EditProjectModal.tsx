import { useEffect, useRef, useState } from 'react'
import { FolderCode, X } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import type { Project } from '../../../shared/types'

export default function EditProjectModal({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  const { updateProject } = useProjectStore()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  // undefined = no change, null = clear, string = new data URL
  const [iconDataUrl, setIconDataUrl] = useState<string | null | undefined>(undefined)
  const [iconPreview, setIconPreview] = useState<string | null>(
    project.iconPath ? `file://${project.iconPath}` : null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) {
      setError('Image must be under 1 MB')
      e.target.value = ''
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setIconPreview(dataUrl)
      setIconDataUrl(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  function handleClearIcon() {
    setIconDataUrl(null)
    setIconPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updateProject(project.id, {
        name: name.trim(),
        description: description.trim(),
        ...(iconDataUrl !== undefined ? { iconDataUrl } : {}),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const hasIcon = iconPreview !== null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
      <div
        className="flex w-[440px] flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-100">Edit project details</p>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Icon + Name row */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800">
              {iconPreview ? (
                <img
                  src={iconPreview}
                  className="h-full w-full object-cover"
                  alt="Project icon"
                  onError={() => setIconPreview(null)}
                />
              ) : (
                <FolderCode className="h-7 w-7 text-zinc-500" />
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Upload new
            </button>
            {(hasIcon || project.iconPath) && (
              <button
                onClick={handleClearIcon}
                className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Clear icon
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-zinc-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              maxLength={60}
              autoFocus
              className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500 transition-colors"
            />
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-500">
              Description <span className="text-zinc-700">(optional)</span>
            </label>
            <span className="text-[10px] text-zinc-700">{description.length}/200</span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            maxLength={200}
            rows={3}
            placeholder="What is this project about?"
            className="resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-md bg-red-950/60 px-3 py-2 text-xs text-red-400">{error}</p>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
