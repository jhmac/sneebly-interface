import { useEffect, useState } from 'react'
import { X, FolderOpen, ChevronDown, GitBranch, LogOut, AlertTriangle } from 'lucide-react'
import type { AppSettings, ModelName, ReflectionEntry } from '../../../shared/types'
import { useGitHubStore } from '../../state/githubStore'
import GitHubConnectModal from '../GitHubPanel/GitHubConnectModal'
import type { GitHubUser } from '../../../shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '../../state/projectStore'
import { useSettingsStore } from '../../state/settingsStore'

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
  const [showConnect, setShowConnect] = useState(false)
  const [reflections, setReflections] = useState<ReflectionEntry[]>([])
  const [openReflection, setOpenReflection] = useState<{ content: string; date: string } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const { connected, user, setConnected, setDisconnected } = useGitHubStore()
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)

  useEffect(() => {
    Promise.all([window.api.settingsGet(), window.api.appVersion()]).then(([s, v]) => {
      setSettings(s)
      setVersion(v)
    })
  }, [])

  useEffect(() => {
    if (activeProject) {
      window.api.reflectionList(activeProject.id).then(setReflections).catch(() => {})
    }
  }, [activeProject?.id])

  async function handleSave(patch: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    useSettingsStore.getState().patch(patch)
    setSaving(true)
    await window.api.settingsSet(patch)
    setSaving(false)
  }

  async function handlePickFolder() {
    const path = await window.api.appOpenFolderDialog()
    if (path) handleSave({ defaultProjectsFolder: path })
  }

  async function handleOpenReflection(entry: ReflectionEntry) {
    const content = await window.api.reflectionRead(entry.path)
    let body = content
    if (content.startsWith('---')) {
      const closing = content.indexOf('---', 3)
      if (closing !== -1) body = content.slice(closing + 3).trimStart()
    }
    setOpenReflection({ content: body, date: entry.date })
  }

  async function handleDeleteAll() {
    if (!activeProject) return
    await window.api.eventsDeleteAll(activeProject.id)
    setReflections([])
    setShowDeleteConfirm(false)
  }

  async function handleDisconnect() {
    await window.api.githubDisconnect()
    setDisconnected()
  }

  function handleConnected(connectedUser: GitHubUser) {
    setConnected(connectedUser)
    setShowConnect(false)
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

        {/* Privacy & Improvement */}
        <Section title="Privacy & Improvement">
          <Row label="Record semantic event stream" description="Persists tool calls and messages for analysis. Stored locally, never uploaded.">
            <Toggle
              value={settings.recordEventStream ?? true}
              onChange={(v) => handleSave({ recordEventStream: v })}
            />
          </Row>
          <Row label="Run nightly reflections" description="After each session, generates a brief friction report using your Claude Code login.">
            <Toggle
              value={settings.runNightlyReflections ?? true}
              onChange={(v) => handleSave({ runNightlyReflections: v })}
            />
          </Row>
          <Row label="Auto-review big changes before declaring done" description="Automatically runs the Self-Review skill after turns that touch many files or lines.">
            <Toggle
              value={settings.autoSelfReview ?? true}
              onChange={(v) => handleSave({ autoSelfReview: v })}
            />
          </Row>
          {(settings.autoSelfReview ?? true) && (
            <Row label="Review threshold" description="Trigger review when files touched or lines changed meets either limit.">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.autoSelfReviewThresholdFiles ?? 3}
                    onChange={(e) => handleSave({ autoSelfReviewThresholdFiles: Math.max(1, Number(e.target.value)) })}
                    className="w-14 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  files
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={settings.autoSelfReviewThresholdLines ?? 100}
                    onChange={(e) => handleSave({ autoSelfReviewThresholdLines: Math.max(1, Number(e.target.value)) })}
                    className="w-16 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  lines
                </label>
              </div>
            </Row>
          )}
          {activeProject && (
            <Row label="Delete all events and reflections" description="Wipes all stored events and reflection files for the current project.">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 rounded-md bg-red-950/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950 transition-colors border border-red-800/40"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Delete all
              </button>
            </Row>
          )}
        </Section>

        {/* Daily Reflections */}
        {activeProject && (
          <Section title="Daily Reflections">
            {reflections.length === 0 ? (
              <p className="text-[10px] text-zinc-600">No reflections yet. Reflections appear after a session with 10+ events.</p>
            ) : (
              <div className="space-y-2">
                {reflections.slice(0, 7).map((r) => (
                  <button
                    key={r.date}
                    onClick={() => handleOpenReflection(r)}
                    className="w-full text-left rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-medium text-zinc-300">{r.date}</span>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                        <span>{r.eventCount} events</span>
                        {r.frictionCount > 0 && (
                          <span className="text-amber-600">{r.frictionCount} friction</span>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 line-clamp-2">{r.summary}</p>
                  </button>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* GitHub */}
        <Section title="GitHub">
          {connected && user ? (
            <Row label="GitHub account" description="Sneebly can read and clone your repositories">
              <div className="flex items-center gap-2">
                {user.avatarUrl && (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="h-6 w-6 rounded-full border border-zinc-700"
                  />
                )}
                <span className="font-mono text-xs text-zinc-300">@{user.login}</span>
                <button
                  onClick={handleDisconnect}
                  title="Disconnect GitHub"
                  className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
                >
                  <LogOut className="h-3 w-3" />
                  Disconnect
                </button>
              </div>
            </Row>
          ) : (
            <Row label="GitHub account" description="Connect to browse and clone your repositories">
              <button
                onClick={() => setShowConnect(true)}
                className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                <GitBranch className="h-3.5 w-3.5" />
                Connect GitHub
              </button>
            </Row>
          )}
        </Section>
      </div>

      {showConnect && (
        <GitHubConnectModal
          onClose={() => setShowConnect(false)}
          onConnected={handleConnected}
        />
      )}

      {openReflection && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
          onClick={(e) => { if (e.target === e.currentTarget) setOpenReflection(null) }}
        >
          <div className="flex w-[640px] max-h-[80vh] flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
              <h2 className="text-sm font-semibold text-zinc-200">Reflection — {openReflection.date}</h2>
              <button
                onClick={() => setOpenReflection(null)}
                className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 prose prose-invert prose-sm max-w-none text-zinc-300 [&_h1]:text-zinc-100 [&_h2]:text-zinc-200 [&_h3]:text-zinc-200 [&_strong]:text-zinc-200 [&_li]:text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-zinc-300 [&_pre]:bg-zinc-900 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {openReflection.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false) }}
        >
          <div className="w-[400px] rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-zinc-200 mb-1">Delete all events and reflections?</h3>
                <p className="text-xs text-zinc-500">This permanently wipes all stored event traces and reflection files for this project. Existing sessions are not affected. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAll}
                className="rounded-md bg-red-900 px-3 py-1.5 text-xs text-red-200 hover:bg-red-800 transition-colors"
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}

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

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={[
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors',
        value ? 'bg-indigo-600' : 'bg-zinc-700',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5',
          value ? 'translate-x-4' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  )
}
