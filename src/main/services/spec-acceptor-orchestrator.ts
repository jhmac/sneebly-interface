import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Store from 'electron-store'
import { listProjects } from './project-registry'
import { loadPhasePlan, getMilestoneById } from './phase-tracker'
import { runSpecAcceptorAgent, type SpecAcceptorResult } from './spec-acceptor-agent'
import type { ModelName } from '../../shared/types'

export type { SpecAcceptorResult }

const store = new Store()

// ─── Settings ─────────────────────────────────────────────────────────────────

function getAcceptorSettings(): { enabled: boolean; model: ModelName } {
  const s = store.get('appSettings', {}) as Record<string, unknown>
  return {
    enabled: (s['specAcceptorEnabled'] as boolean | undefined) ?? true,
    model: (s['specAcceptorModel'] as ModelName | undefined) ?? 'claude-sonnet-4-6',
  }
}

// ─── Spec loading ─────────────────────────────────────────────────────────────

interface SpecInfo {
  specText: string
  milestoneText: string
}

/**
 * Load the spec text and milestone display name in a single plan read.
 * Prefers the spec file on disk; falls back to kickoffPrompt.
 * Returns null if the plan, milestone, or spec text cannot be resolved.
 */
function loadSpecInfo(projectPath: string, milestoneId: string): SpecInfo | null {
  const plan = loadPhasePlan(projectPath)
  if (!plan) return null
  const milestone = getMilestoneById(plan, milestoneId)
  if (!milestone) return null

  const milestoneText = milestone.text

  if (milestone.specPath) {
    // Resolve to an absolute path and enforce containment within the project root
    // to prevent path traversal via crafted specPath values.
    const resolvedRoot = resolve(projectPath)
    const absPath = milestone.specPath.startsWith('/')
      ? milestone.specPath
      : resolve(join(resolvedRoot, milestone.specPath))

    const contained = absPath.startsWith(resolvedRoot + '/') || absPath === resolvedRoot
    if (contained && existsSync(absPath)) {
      try {
        return { specText: readFileSync(absPath, 'utf-8'), milestoneText }
      } catch { /* fall through to kickoffPrompt */ }
    }
  }

  return milestone.kickoffPrompt
    ? { specText: milestone.kickoffPrompt, milestoneText }
    : null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Spec Acceptor for a milestone after its build completes.
 *
 * Loads settings, resolves the spec text, normalises file paths, and delegates
 * to the acceptor agent. Returns null on any failure (disabled, no spec, agent
 * error, parse failure) — phase-runner treats null as pass-through so builds
 * are never blocked by acceptor failures.
 *
 * @param projectId     The project whose run state is active
 * @param milestoneId   The just-built milestone
 * @param changedFiles  Absolute paths from buildMetrics.filesTouched
 */
export async function runSpecAcceptor(
  projectId: string,
  milestoneId: string,
  changedFiles: string[],
): Promise<SpecAcceptorResult | null> {
  const settings = getAcceptorSettings()
  if (!settings.enabled) return null

  const project = listProjects().find((p) => p.id === projectId)
  if (!project) return null

  // Single plan load: get spec text + milestone display name together.
  const specInfo = loadSpecInfo(project.path, milestoneId)
  if (!specInfo) {
    console.warn(`[spec-acceptor-orchestrator] no spec text for ${milestoneId} — skipping`)
    return null
  }

  // Convert to project-relative paths, drop anything outside the project root,
  // strip Sneebly's internal metadata directory (event-stream JSON, decision
  // files, etc. — irrelevant to spec conformance and wastes Read tool turns),
  // and cap at 25 entries so the agent prompt stays manageable.
  const relFiles = changedFiles
    .filter((f) => f.startsWith(project.path + '/'))
    .map((f) => f.slice(project.path.length + 1))
    .filter((f) => !f.startsWith('.sneebly-interface/'))
    .slice(0, 25)

  console.log(
    `[spec-acceptor-orchestrator] running for ${milestoneId}` +
    ` (${relFiles.length} changed file${relFiles.length !== 1 ? 's' : ''})`,
  )

  try {
    return await runSpecAcceptorAgent({
      projectPath: project.path,
      projectId,
      specText: specInfo.specText,
      milestoneText: specInfo.milestoneText,
      changedFiles: relFiles,
      model: settings.model,
    })
  } catch (e) {
    console.error('[spec-acceptor-orchestrator] agent threw unexpectedly:', e)
    return null
  }
}
