import { useEffect, useState } from 'react'
import { X, FolderOpen, ChevronDown } from 'lucide-react'
import type { AppSettings, ModelName } from '../../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
}

const MODEL_OPTIONS: Array<{ value: ModelName; label: string }> = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-opus-4-7',   label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5' },
]

export default function SettingsPanel({ open, onClose }: Props) {
  if (!open) return null
  return <SettingsPanelInner onClose={onClose} />
}

function SettingsPanelInner({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [version, setVersion] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([window.api.settingsGet(), window.api.appVersion()]).then(([s, v]) => {
      setSettings(s)
      setVersion(v)
    })
  }, [])

  async function handleSave(patch: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    setSaving(true)
    await window.api.settingsSet(patch)
    setSaving(false)
  }

  async function handlePickFolder() {
    const path = await window.api.appOpenFolderDialog()
    if (path) handleSave({ defaultProjectsFolder: path })
  }

  if (!settings) {
    return (
      <ModalShell onClose={onClose}>
        <div className="flex h-64 items-center justify-center text-sm text-zinc-600">Loading…</div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Settings</h2>
          <p className="text-[10px] text-zinc-600">v{version}</p>
        </div>
        <button onClick={onClose} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
        {/* Appearance */}
        <Section title="Appearance">
          <Row label="Theme" description="Light theme coming in a future update">
            <div className="flex rounded-md bg-zinc-800 p-0.5">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => t === 'dark' && handleSave({ theme: t })}
                  disabled={t === 'light'}
                  className={[
                    'rounded px-3 py-1 text-xs font-medium transition-colors capitalize',
                    settings.theme === t
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'text-zinc-500 hover:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-40',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Agent */}
        <Section title="Agent">
          <Row label="Default model" description="Used for new sessions (can be changed per session)">
            <div className="relative">
              <select
                value={settings.defaultModel}
                onChange={(e) => handleSave({ defaultModel: e.target.value as ModelName })}
                className="appearance-none rounded-md bg-zinc-800 py-1.5 pl-3 pr-8 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
            </div>
          </Row>
        </Section>

        {/* Projects */}
        <Section title="Projects">
          <Row label="Default projects folder" description="Where cloned repos are placed by default">
            <button
              onClick={handlePickFolder}
              className="flex max-w-[280px] items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
              <span className="truncate font-mono">{settings.defaultProjectsFolder}</span>
            </button>
          </Row>
        </Section>

        {/* MCP Servers */}
        <Section title="MCP Servers">
          <div className="rounded-md border border-zinc-800 bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Registered servers</span>
            </div>
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-xs text-zinc-300">sneebly-browser-check</span>
                <span className="rounded bg-green-900/40 px-1.5 text-[10px] text-green-400">built-in</span>
              </div>
              <p className="text-[10px] text-zinc-600">
                Headless Chromium browser inspection. Registered automatically via{' '}
                <code className="text-zinc-500">--mcp-config</code> on every agent turn.
              </p>
            </div>
            {settings.mcpServers.length === 0 && (
              <div className="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-700">
                No additional MCP servers configured. Custom servers can be added in a future update.
              </div>
            )}
          </div>
        </Section>

        {/* GitHub */}
        <Section title="GitHub">
          <Row label="GitHub account" description="OAuth integration coming in Phase 6">
            <button
              disabled
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-600 disabled:cursor-not-allowed"
            >
              Disconnect GitHub (not connected)
            </button>
          </Row>
        </Section>
      </div>

      {saving && (
        <div className="flex-shrink-0 border-t border-zinc-800 px-6 py-2 text-[10px] text-zinc-600">
          Saving…
        </div>
      )}
    </ModalShell>
  )
}

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex w-[560px] max-h-[80vh] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-xs font-medium text-zinc-300">{label}</p>
        {description && <p className="mt-0.5 text-[10px] text-zinc-600">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}
