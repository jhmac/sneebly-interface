import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

function loadSpecText(projectPath: string, milestoneId: string): string | null {
  const plan = loadPhasePlan(projectPath)
  if (!plan) return null
  const milestone = getMilestoneById(plan, milestoneId)
  if (!milestone) return null

  if (milestone.specPath) {
    const absPath = milestone.specPath.startsWith('/')
      ? milestone.specPath
      : join(projectPath, milestone.specPath)
    if (existsSync(absPath)) {
      try {
        return readFileSync(absPath, 'utf-8')
      } catch { /* fall through to kickoffPrompt */ }
    }
  }

  return milestone.kickoffPrompt || null
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

  const specText = loadSpecText(project.path, milestoneId)
  if (!specText) {
    console.warn(`[spec-acceptor-orchestrator] no spec text for ${milestoneId} — skipping`)
    return null
  }

  const plan = loadPhasePlan(project.path)
  const milestone = plan ? getMilestoneById(plan, milestoneId) : null
  const milestoneText = milestone?.text ?? milestoneId

  // Convert to project-relative paths, drop anything outside the project root,
  // cap at 25 entries so the agent prompt stays manageable.
  const relFiles = changedFiles
    .filter((f) => f.startsWith(project.path + '/'))
    .map((f) => f.slice(project.path.length + 1))
    .slice(0, 25)

  console.log(
    `[spec-acceptor-orchestrator] running for ${milestoneId}` +
    ` (${relFiles.length} changed file${relFiles.length !== 1 ? 's' : ''})`,
  )

  try {
    return await runSpecAcceptorAgent({
      projectPath: project.path,
      projectId,
      specText,
      milestoneText,
      changedFiles: relFiles,
      model: settings.model,
    })
  } catch (e) {
    console.error('[spec-acceptor-orchestrator] agent threw unexpectedly:', e)
    return null
  }
}
