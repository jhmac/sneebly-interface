import { create } from 'zustand'
import type {
  AuditId, AuditMeta, AuditFinding, AuditProgressEvent, AuditStatus,
  AuditScope, AuditMode, AuditListEntry, AuditEstimate,
} from '../../shared/types'

// ─── Default scope ────────────────────────────────────────────────────────────

export const DEFAULT_SCOPE: AuditScope = {
  codeReview: true,
  securityScan: true,
  schemaReview: true,
  conventionCheck: true,
  dependencySecurityCheck: true,
  envVarCheck: true,
  staleTodoCheck: true,
}

// ─── Filter/group prefs ───────────────────────────────────────────────────────

export type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'
export type CategoryFilter = 'all' | 'security' | 'correctness' | 'convention' | 'smell' | 'schema' | 'depsec' | 'env' | 'todo'
export type GroupBy = 'none' | 'file' | 'category' | 'severity'

interface AuditorStore {
  // ── Config modal ─────────────────────────────────────────────────────────
  configOpen: boolean
  scope: AuditScope
  mode: AuditMode
  subsetPaths: string[]
  estimate: AuditEstimate | null
  estimating: boolean

  // ── Active audit ─────────────────────────────────────────────────────────
  // activeAuditId = the audit currently *selected* for viewing (findings browser,
  // history highlight, reveal-in-finder). It persists after completion.
  // runningAuditId = the audit currently *running*; cleared on done/cancel. These
  // are distinct: viewing a finished audit's findings must not look "still running".
  activeAuditId: AuditId | null
  runningAuditId: AuditId | null
  activeProgress: AuditProgressEvent | null
  activeMeta: AuditMeta | null

  // ── Findings browser ─────────────────────────────────────────────────────
  browserOpen: boolean
  findings: AuditFinding[]
  findingsLoading: boolean
  severityFilter: SeverityFilter
  categoryFilter: CategoryFilter
  groupBy: GroupBy
  fileSearch: string
  showResolved: boolean
  showFalsePositives: boolean
  selectedFindingId: string | null

  // ── Audit history ────────────────────────────────────────────────────────
  historyOpen: boolean
  history: AuditListEntry[]
  historyLoading: boolean

  // ── Actions ──────────────────────────────────────────────────────────────
  openConfig: () => void
  closeConfig: () => void
  setScope: (scope: AuditScope) => void
  setMode: (mode: AuditMode) => void
  setSubsetPaths: (paths: string[]) => void
  setEstimate: (estimate: AuditEstimate | null) => void
  setEstimating: (v: boolean) => void

  markAuditStarted: (auditId: AuditId) => void
  handleProgress: (event: AuditProgressEvent) => void
  handleDone: (auditId: AuditId, status: AuditStatus) => void
  clearActiveAudit: () => void

  openBrowser: (auditId: AuditId) => void
  closeBrowser: () => void
  setFindings: (findings: AuditFinding[]) => void
  setSeverityFilter: (f: SeverityFilter) => void
  setCategoryFilter: (f: CategoryFilter) => void
  setGroupBy: (g: GroupBy) => void
  setFileSearch: (s: string) => void
  setShowResolved: (v: boolean) => void
  setShowFalsePositives: (v: boolean) => void
  selectFinding: (id: string | null) => void
  patchFinding: (id: string, patch: Partial<AuditFinding>) => void

  openHistory: () => void
  closeHistory: () => void
  setHistory: (history: AuditListEntry[]) => void
  setHistoryLoading: (v: boolean) => void
}

export const useAuditorStore = create<AuditorStore>((set, get) => ({
  configOpen: false,
  scope: DEFAULT_SCOPE,
  mode: 'full',
  subsetPaths: [],
  estimate: null,
  estimating: false,

  activeAuditId: null,
  runningAuditId: null,
  activeProgress: null,
  activeMeta: null,

  browserOpen: false,
  findings: [],
  findingsLoading: false,
  severityFilter: 'all',
  categoryFilter: 'all',
  groupBy: 'none',
  fileSearch: '',
  showResolved: false,
  showFalsePositives: false,
  selectedFindingId: null,

  historyOpen: false,
  history: [],
  historyLoading: false,

  openConfig: () => set({ configOpen: true }),
  closeConfig: () => set({ configOpen: false, estimate: null }),
  setScope: (scope) => set({ scope }),
  setMode: (mode) => set({ mode }),
  setSubsetPaths: (subsetPaths) => set({ subsetPaths }),
  setEstimate: (estimate) => set({ estimate }),
  setEstimating: (estimating) => set({ estimating }),

  // Called as soon as an audit is started so the running indicator responds
  // immediately, before the first progress event (discovery can be slow).
  markAuditStarted: (auditId) => set({ runningAuditId: auditId }),
  handleProgress: (event) =>
    set({ activeAuditId: event.auditId, runningAuditId: event.auditId, activeProgress: event }),
  handleDone: (auditId) => {
    set((s) => ({
      // Stop the "running" indicator for this audit. Keep activeAuditId so the
      // findings browser / history selection for it survive completion.
      runningAuditId: s.runningAuditId === auditId ? null : s.runningAuditId,
      activeProgress: s.runningAuditId === auditId ? null : s.activeProgress,
      // Mark findings as needing refresh if browser is showing this audit
      findingsLoading: s.browserOpen && s.activeAuditId === auditId ? true : s.findingsLoading,
    }))
  },
  clearActiveAudit: () => set({ activeAuditId: null, runningAuditId: null, activeProgress: null, activeMeta: null }),

  openBrowser: (auditId) => set({ browserOpen: true, findingsLoading: true, activeAuditId: auditId }),
  closeBrowser: () => set({ browserOpen: false, selectedFindingId: null }),
  setFindings: (findings) => set({ findings, findingsLoading: false }),
  setSeverityFilter: (severityFilter) => set({ severityFilter, selectedFindingId: null }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter, selectedFindingId: null }),
  setGroupBy: (groupBy) => set({ groupBy }),
  setFileSearch: (fileSearch) => set({ fileSearch }),
  setShowResolved: (showResolved) => set({ showResolved }),
  setShowFalsePositives: (showFalsePositives) => set({ showFalsePositives }),
  selectFinding: (selectedFindingId) => set({ selectedFindingId }),
  patchFinding: (id, patch) =>
    set((s) => ({
      findings: s.findings.map((f) => f.id === id ? { ...f, ...patch } : f),
    })),

  openHistory: () => set({ historyOpen: true, historyLoading: true }),
  closeHistory: () => set({ historyOpen: false }),
  setHistory: (history) => set({ history, historyLoading: false }),
  setHistoryLoading: (historyLoading) => set({ historyLoading }),
}))

// ─── Derived selectors ────────────────────────────────────────────────────────

export function getFilteredFindings(store: AuditorStore): AuditFinding[] {
  let findings = store.findings

  if (!store.showResolved) findings = findings.filter((f) => !f.resolved)
  if (!store.showFalsePositives) findings = findings.filter((f) => !f.falsePositive)
  if (store.severityFilter !== 'all') findings = findings.filter((f) => f.severity === store.severityFilter)
  if (store.categoryFilter !== 'all') findings = findings.filter((f) => f.category === store.categoryFilter)
  if (store.fileSearch) {
    const q = store.fileSearch.toLowerCase()
    findings = findings.filter((f) => f.filePath.toLowerCase().includes(q) || f.title.toLowerCase().includes(q))
  }

  return findings
}
