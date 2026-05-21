import { useEffect, useRef, useState } from 'react'
import { X, Eye, EyeOff, Trash2, Plus, Upload, Download, Pencil, Check } from 'lucide-react'
import { useSecretsStore } from '../../state/secretsStore'
import { useProjectStore } from '../../state/projectStore'
import { usePreviewStore } from '../../state/previewStore'

export default function SecretsPanel() {
  const { panelOpen, closePanel } = useSecretsStore()
  if (!panelOpen) return null
  return <SecretsPanelInner onClose={closePanel} />
}

function SecretsPanelInner({ onClose }: { onClose: () => void }) {
  const { activeProjectId, projects } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const projectId = activeProject?.id ?? ''

  const {
    secretNames,
    revealed,
    loadNames,
    reveal,
    maskNow,
    setSecret,
    deleteSecret,
    importEnv,
    exportEnv,
    reset,
  } = useSecretsStore()

  const { status } = usePreviewStore()
  const [addingNew, setAddingNew] = useState(false)
  const [restartBanner, setRestartBanner] = useState(false)

  useEffect(() => {
    if (!projectId) return
    loadNames(projectId)
    return () => reset()
  }, [projectId])

  function showRestartBanner() {
    if (status === 'running') setRestartBanner(true)
  }

  async function handleSet(name: string, value: string) {
    await setSecret(projectId, name, value)
    showRestartBanner()
  }

  async function handleDelete(name: string) {
    await deleteSecret(projectId, name)
    showRestartBanner()
  }

  async function handleImport() {
    const content = await promptEnvContent()
    if (content === null) return
    const imported = await importEnv(projectId, content)
    if (imported.length > 0) showRestartBanner()
  }

  async function handleExport() {
    const content = await exportEnv(projectId)
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '.env'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleRestart() {
    if (!activeProject) return
    window.api.previewRestart(activeProject.id, activeProject.path)
    setRestartBanner(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex w-[600px] max-h-[80vh] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-200">Secrets</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              title="Import from .env"
              className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
            >
              <Upload className="h-3 w-3" />
              Import .env
            </button>
            <button
              onClick={handleExport}
              disabled={secretNames.length === 0}
              title="Export as .env"
              className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3 w-3" />
              Export .env
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Restart banner */}
        {restartBanner && (
          <div className="flex flex-shrink-0 items-center justify-between border-b border-amber-900/50 bg-amber-950/40 px-5 py-2.5">
            <span className="text-xs text-amber-400">Restart dev server to apply new secrets</span>
            <div className="flex gap-2">
              <button
                onClick={() => setRestartBanner(false)}
                className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                Dismiss
              </button>
              <button
                onClick={handleRestart}
                className="rounded-md bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 transition-colors"
              >
                Restart now
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {secretNames.length === 0 && !addingNew && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12">
            <p className="text-sm text-zinc-500">No secrets yet</p>
            <p className="text-xs text-zinc-700">Secrets are stored in macOS Keychain and injected as env vars</p>
          </div>
        )}

        {/* Secret rows */}
        {(secretNames.length > 0 || addingNew) && (
          <div className="flex-1 overflow-y-auto">
            {secretNames.map((name) => (
              <SecretRow
                key={name}
                name={name}
                revealedValue={revealed.get(name)?.value ?? null}
                onReveal={() => reveal(projectId, name)}
                onMask={() => maskNow(name)}
                onSave={(newName, value) => handleSet(newName, value)}
                onDelete={() => handleDelete(name)}
              />
            ))}
            {addingNew && (
              <NewSecretRow
                onSave={async (name, value) => {
                  await handleSet(name, value)
                  setAddingNew(false)
                }}
                onCancel={() => setAddingNew(false)}
              />
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center border-t border-zinc-800 px-5 py-3">
          <button
            onClick={() => setAddingNew(true)}
            disabled={addingNew}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            New secret
          </button>
          <p className="ml-auto text-[10px] text-zinc-700">Stored in macOS Keychain — never written to disk</p>
        </div>
      </div>
    </div>
  )
}

function SecretRow({
  name,
  revealedValue,
  onReveal,
  onMask,
  onSave,
  onDelete,
}: {
  name: string
  revealedValue: string | null
  onReveal: () => void
  onMask: () => void
  onSave: (name: string, value: string) => Promise<void>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setEditName(name)
    setEditValue(revealedValue ?? '')
    setEditing(true)
    setTimeout(() => nameRef.current?.focus())
  }

  async function save() {
    const n = editName.trim()
    if (!n) return
    setSaving(true)
    await onSave(n, editValue)
    setSaving(false)
    setEditing(false)
    onMask()
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-3">
        <input
          ref={nameRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-40 flex-shrink-0 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-indigo-500"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        />
        <input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          type="text"
          placeholder="value"
          className="flex-1 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-indigo-500"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded p-1.5 text-indigo-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-3 border-b border-zinc-800 px-5 py-3 hover:bg-zinc-800/40">
      <span className="w-40 flex-shrink-0 truncate font-mono text-xs text-zinc-300">{name}</span>
      <span className="flex-1 truncate font-mono text-xs text-zinc-600">
        {revealedValue !== null ? revealedValue : '••••••••••••'}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {revealedValue !== null ? (
          <button
            onClick={onMask}
            title="Hide"
            className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400 transition-colors"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={onReveal}
            title="Reveal (10s)"
            className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={startEdit}
          title="Edit"
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function NewSecretRow({
  onSave,
  onCancel,
}: {
  onSave: (name: string, value: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  async function save() {
    const n = name.trim()
    if (!n) return
    setSaving(true)
    await onSave(n, value)
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-800/30 px-5 py-3">
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="SECRET_NAME"
        className="w-40 flex-shrink-0 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:ring-1 focus:ring-indigo-500"
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="text"
        placeholder="value"
        className="flex-1 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:ring-1 focus:ring-indigo-500"
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
      />
      <button
        onClick={save}
        disabled={saving || !name.trim()}
        className="rounded p-1.5 text-indigo-400 hover:bg-zinc-700 transition-colors disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onCancel}
        className="rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// Prompts the user to paste or type .env content via a simple textarea overlay
async function promptEnvContent(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7)'

    const box = document.createElement('div')
    box.style.cssText =
      'background:#18181b;border:1px solid #3f3f46;border-radius:12px;padding:20px;width:480px;display:flex;flex-direction:column;gap:12px'

    const label = document.createElement('p')
    label.textContent = 'Paste .env content'
    label.style.cssText = 'color:#d4d4d8;font-size:13px;font-weight:600;margin:0'

    const ta = document.createElement('textarea')
    ta.placeholder = 'KEY=value\nANOTHER_KEY=another_value'
    ta.style.cssText =
      'background:#27272a;border:1px solid #3f3f46;border-radius:6px;color:#d4d4d8;font-family:monospace;font-size:11px;height:160px;outline:none;padding:8px;resize:none;width:100%;box-sizing:border-box'

    const btns = document.createElement('div')
    btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'

    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    cancel.style.cssText =
      'background:#27272a;border:none;border-radius:6px;color:#a1a1aa;cursor:pointer;font-size:12px;padding:6px 14px'

    const ok = document.createElement('button')
    ok.textContent = 'Import'
    ok.style.cssText =
      'background:#4f46e5;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;padding:6px 14px'

    btns.appendChild(cancel)
    btns.appendChild(ok)
    box.appendChild(label)
    box.appendChild(ta)
    box.appendChild(btns)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    ta.focus()

    function cleanup(result: string | null) {
      document.body.removeChild(overlay)
      resolve(result)
    }

    cancel.onclick = () => cleanup(null)
    ok.onclick = () => cleanup(ta.value)
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null) }
    ta.onkeydown = (e) => { if (e.key === 'Escape') cleanup(null) }
  })
}
