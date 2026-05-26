import { useEffect, useState } from 'react'
import { X, FolderOpen, ChevronDown, GitBranch, LogOut, AlertTriangle } from 'lucide-react'
import type { AppSettings, ModelName, ReflectionEntry, UsageDailyStat } from '../../../shared/types'
import { useGitHubStore } from '../../state/githubStore'
import GitHubConnectModal from '../GitHubPanel/GitHubConnectModal'
import type { GitHubUser } from '../../../shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '../../state/projectStore'
import { useSettingsStore } from '../../state/settingsStore'
import { fmtTokens, fmtDuration, tsToDateKey } from '../../../shared/utils'

interface Props {
  open: boolean
  onClose: () => void
  activeProjectId?: string | null
}

const MODEL_OPTIONS: Array<{ value: ModelName; label: string }> = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-opus-4-7',   label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5' },
]

const REVIEW_MODEL_OPTIONS: Array<{ value: ModelName; label: string }> = [
  { value: 'claude-opus-4-7',   label: 'Opus 4.7 (more thorough, slower)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
  { value: 'claude-haiku-4-5',  label: 'Haiku 4.5 (faster, cheaper)' },
]

export default function SettingsPanel({ open, onClose, activeProjectId }: Props) {
  if (!open) return null
  return <SettingsPanelInner onClose={onClose} activeProjectId={activeProjectId} />
}

function SettingsPanelInner({ onClose, activeProjectId }: { onClose: () => void; activeProjectId?: string | null }) {
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

        <Section title="Phase Runner">
          <Row label="Build model" description="Model used for each milestone build turn. Independent of the chat model — Sonnet is recommended; Haiku will silently fail on complex milestones.">
            <div className="relative">
              <select
                value={settings.phaseRunnerPrimaryModel ?? 'claude-sonnet-4-6'}
                onChange={(e) => handleSave({ phaseRunnerPrimaryModel: e.target.value as ModelName })}
                className="appearance-none rounded-md bg-zinc-800 py-1.5 pl-3 pr-8 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
              >
                {REVIEW_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
            </div>
          </Row>
          <Row label="Review model" description="Model used for the per-milestone review pass after each successful build. Opus gives deeper bug and refactor analysis.">
            <div className="relative">
              <select
                value={settings.phaseRunnerEscalationModel ?? 'claude-opus-4-7'}
                onChange={(e) => handleSave({ phaseRunnerEscalationModel: e.target.value as ModelName })}
                className="appearance-none rounded-md bg-zinc-800 py-1.5 pl-3 pr-8 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
              >
                {REVIEW_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
            </div>
          </Row>
          <Row label="Run UI smoke tests" description="After each UI milestone builds, load the dev server in headless Chromium and verify the page renders without console errors or broken assets. Adds ~5s per UI milestone.">
            <Toggle
              value={settings.runUISmokeTests ?? true}
              onChange={(v) => handleSave({ runUISmokeTests: v })}
            />
          </Row>
          <Row label="Run Playwright checklist tests" description="Generates and runs a Playwright spec from each UI milestone's test checklist. Adds 30-60s per milestone. Failures surface as warnings — they don't pause the run.">
            <Toggle
              value={settings.runPlaywrightChecklistTests ?? false}
              onChange={(v) => handleSave({ runPlaywrightChecklistTests: v })}
            />
          </Row>
          <Row label="Auto-commit milestones" description="After each milestone completes, commit Claude's changes + GOALS.md to git automatically. Disables silently if the project isn't a git repo.">
            <Toggle
              value={settings.autoCommitMilestones ?? true}
              onChange={(v) => handleSave({ autoCommitMilestones: v })}
            />
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
          <Row label="Record token usage" description="Tracks input and output token counts per session in tokens.json. Counts and timestamps only — no prompt or response text.">
            <Toggle
              value={settings.recordTokenUsage ?? true}
              onChange={(v) => handleSave({ recordTokenUsage: v })}
            />
          </Row>
          <Row label="Apply nightly learnings to new sessions" description="Injects a summary of recent reflections as system context on the first turn of each new session.">
            <Toggle
              value={settings.applyLearnings ?? true}
              onChange={(v) => handleSave({ applyLearnings: v })}
            />
          </Row>
          {(settings.applyLearnings ?? true) && (
            <>
              <Row label="Learnings lookback" description="How many days back to pull reflections from.">
                <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={settings.learningsMaxAgeDays ?? 14}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isInteger(v) && v >= 1) handleSave({ learningsMaxAgeDays: v })
                    }}
                    className="w-14 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  days
                </label>
              </Row>
              <Row label="Learnings word budget" description="Maximum words of reflection content injected per session.">
                <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="number"
                    min={100}
                    max={2000}
                    step={100}
                    value={settings.learningsMaxWords ?? 800}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isInteger(v) && v >= 100) handleSave({ learningsMaxWords: v })
                    }}
                    className="w-16 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  words
                </label>
              </Row>
            </>
          )}
          {(settings.autoSelfReview ?? true) && (
            <>
              <Row label="Review threshold" description="Trigger review when files touched or lines changed meets either limit.">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.autoSelfReviewThresholdFiles ?? 3}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isInteger(v) && v >= 1) handleSave({ autoSelfReviewThresholdFiles: v })
                      }}
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
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isInteger(v) && v >= 1) handleSave({ autoSelfReviewThresholdLines: v })
                      }}
                      className="w-16 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                    lines
                  </label>
                </div>
              </Row>
              <Row label="Review model" description="Model used for the auto-review pass. Opus gives deeper analysis; Haiku is faster and cheaper.">
                <div className="relative">
                  <select
                    value={settings.autoSelfReviewModel ?? 'claude-opus-4-7'}
                    onChange={(e) => handleSave({ autoSelfReviewModel: e.target.value as ModelName })}
                    className="appearance-none rounded-md bg-zinc-800 py-1.5 pl-3 pr-8 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-600"
                  >
                    {REVIEW_MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
                </div>
              </Row>
            </>
          )}
          <Row label="Propose learnings from reflections" description="After a session with 3+ friction events, uses Haiku to propose system-prompt additions you can review and approve.">
            <Toggle
              value={settings.generateLearningProposals ?? true}
              onChange={(v) => handleSave({ generateLearningProposals: v })}
            />
          </Row>
          <Row label="Run shadow sessions" description="When a learning is proposed, automatically runs a quick Haiku shadow session to preview how the learning would change behavior.">
            <Toggle
              value={settings.runShadowSessions ?? false}
              onChange={(v) => handleSave({ runShadowSessions: v })}
            />
          </Row>
          <Row label="Show suggested shortcuts" description="Display up to 2 auto-suggested shortcuts in the workspace top bar, based on recently opened files and used skills.">
            <Toggle
              value={settings.showSuggestedShortcuts ?? true}
              onChange={(v) => handleSave({ showSuggestedShortcuts: v })}
            />
          </Row>
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

        {/* Usage */}
        {activeProjectId && (
          <UsageSection projectId={activeProjectId} />
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

// ── Usage section ──────────────────────────────────────────────────────────

function UsageSection({ projectId }: { projectId: string }) {
  const [data, setData] = useState<UsageDailyStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.usageTimeseries(projectId, 30).then((d) => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [projectId])

  if (loading) return (
    <Section title="Usage">
      <p className="text-[10px] text-zinc-600">Loading…</p>
    </Section>
  )
  if (data.length === 0) return (
    <Section title="Usage">
      <p className="text-[10px] text-zinc-600">No usage data yet. Send a message to start recording.</p>
    </Section>
  )

  const today = Date.now()

  // Fill in all 30 days (including zero-activity days) for the chart.
  // tsToDateKey produces local-time date strings so chart alignment is correct.
  const byDate = new Map(data.map((d) => [d.date, d]))
  const days: UsageDailyStat[] = []
  for (let i = 29; i >= 0; i--) {
    const key = tsToDateKey(today - i * 86_400_000)
    days.push(byDate.get(key) ?? { date: key, totalInput: 0, totalOutput: 0, durationMs: 0, sessionCount: 0 })
  }

  const maxTokens = Math.max(...days.map((d) => d.totalInput + d.totalOutput), 1)

  // Date-string comparisons are safe for YYYY-MM-DD: lexicographic order == chronological order.
  // tsToDateKey uses local time, matching how dates are stored in usage-store.ts.
  const thisWeekStartKey = tsToDateKey(today - 7 * 86_400_000)
  const lastWeekStartKey = tsToDateKey(today - 14 * 86_400_000)
  const thisWeek = data.filter((d) => d.date >= thisWeekStartKey)
  const lastWeek = data.filter((d) => d.date >= lastWeekStartKey && d.date < thisWeekStartKey)

  const thisMs = thisWeek.reduce((n, d) => n + d.durationMs, 0)
  const lastMs = lastWeek.reduce((n, d) => n + d.durationMs, 0)
  const thisTokens = thisWeek.reduce((n, d) => n + d.totalInput + d.totalOutput, 0)
  const lastTokens = lastWeek.reduce((n, d) => n + d.totalInput + d.totalOutput, 0)
  const timeDelta = lastMs > 0 ? Math.round(((thisMs - lastMs) / lastMs) * 100) : null
  const tokenDelta = lastTokens > 0 ? Math.round(((thisTokens - lastTokens) / lastTokens) * 100) : null

  // Build 4-week table (newest first) using date-string boundaries.
  const weeks: Array<{ label: string; tokens: number; durationMs: number; sessions: number }> = []
  for (let w = 0; w < 4; w++) {
    const wEndKey = tsToDateKey(today - w * 7 * 86_400_000 + 1)
    const wStartKey = tsToDateKey(today - (w + 1) * 7 * 86_400_000)
    const wData = data.filter((d) => d.date >= wStartKey && d.date < wEndKey)
    const label = w === 0 ? 'This week' : w === 1 ? 'Last week' : `${w + 1} weeks ago`
    weeks.push({
      label,
      tokens: wData.reduce((n, d) => n + d.totalInput + d.totalOutput, 0),
      durationMs: wData.reduce((n, d) => n + d.durationMs, 0),
      sessions: wData.reduce((n, d) => n + d.sessionCount, 0),
    })
  }

  return (
    <Section title="Usage">
      {/* Headline */}
      <div className="rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 mb-3">
        <p className="text-xs text-zinc-300">
          This week: <span className="font-medium">{fmtDuration(thisMs)}</span> · <span className="font-medium">{fmtTokens(thisTokens)} tokens</span>
          {timeDelta !== null && (
            <span className={['ml-2 text-[10px]', timeDelta < 0 ? 'text-green-400' : 'text-zinc-500'].join(' ')}>
              {timeDelta > 0 ? '+' : ''}{timeDelta}% time vs last week
            </span>
          )}
          {tokenDelta !== null && (
            <span className="ml-1.5 text-[10px] text-zinc-600">
              {tokenDelta > 0 ? '+' : ''}{tokenDelta}% tokens
            </span>
          )}
        </p>
      </div>

      {/* SVG bar chart — last 30 days */}
      <div className="mb-3">
        <p className="text-[10px] text-zinc-600 mb-1.5">Last 30 days (tokens/day)</p>
        <svg viewBox={`0 0 ${days.length * 10 - 2} 48`} className="w-full h-12" preserveAspectRatio="none">
          {days.map((d, i) => {
            const total = d.totalInput + d.totalOutput
            const h = Math.max(total > 0 ? 2 : 0, Math.round((total / maxTokens) * 44))
            return (
              <rect
                key={d.date}
                x={i * 10}
                y={48 - h}
                width={8}
                height={h}
                rx={1}
                className={total > 0 ? 'fill-indigo-500' : 'fill-zinc-800'}
              />
            )
          })}
        </svg>
      </div>

      {/* Weekly table */}
      <div className="rounded-md border border-zinc-800 overflow-hidden text-[10px]">
        <div className="grid grid-cols-4 bg-zinc-900/60 px-2 py-1.5 font-medium text-zinc-500 uppercase tracking-wide">
          <span>Week</span>
          <span className="text-right">Tokens</span>
          <span className="text-right">Time</span>
          <span className="text-right">Sessions</span>
        </div>
        {weeks.map((w) => (
          <div key={w.label} className="grid grid-cols-4 px-2 py-1.5 border-t border-zinc-800 text-zinc-400">
            <span className="text-zinc-300">{w.label}</span>
            <span className="text-right font-mono">{w.tokens > 0 ? fmtTokens(w.tokens) : '—'}</span>
            <span className="text-right font-mono">{w.durationMs > 0 ? fmtDuration(w.durationMs) : '—'}</span>
            <span className="text-right font-mono">{w.sessions > 0 ? String(w.sessions) : '—'}</span>
          </div>
        ))}
      </div>
    </Section>
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
