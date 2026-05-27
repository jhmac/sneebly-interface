import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Store from 'electron-store'
import { listProjects } from './project-registry'
import { loadPhasePlan, getMilestoneById, unmarkMilestoneSkipped } from './phase-tracker'
import { bundleContext } from './decider-context-bundler'
import { runDeciderAgent } from './decider-agent'
import {
  saveDecisions,
  loadDecisions,
  getDecisionsFilePaths,
  countFlaggedDecisions,
} from './decider-store'
import type { DeciderRunResult, DecisionsFile, ModelName, PhasePlan } from '../../shared/types'

export { loadDecisions, countFlaggedDecisions, getDecisionsFilePaths }

// ─── Settings helpers ─────────────────────────────────────────────────────────

const store = new Store()

interface DeciderSettings {
  enabled: boolean
  model: ModelName
}

function getDeciderSettings(): DeciderSettings {
  const s = store.get('appSettings', {}) as Record<string, unknown>
  return {
    enabled: (s['deciderEnabled'] as boolean | undefined) ?? true,
    model: (s['deciderModel'] as ModelName | undefined) ?? 'claude-sonnet-4-6',
  }
}

// ─── Spec loading ─────────────────────────────────────────────────────────────

interface SpecInfo {
  text: string
  specPath: string
}

/**
 * Load the spec text for a milestone, returning both the text and the resolved
 * specPath so callers don't need to re-parse the plan.
 * Prefers the spec file on disk (milestone.specPath); falls back to kickoffPrompt.
 */
function loadSpecInfo(projectPath: string, milestoneId: string): SpecInfo | null {
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
        return { text: readFileSync(absPath, 'utf-8'), specPath: milestone.specPath }
      } catch { /* fall through to kickoffPrompt */ }
    }
  }

  return milestone.kickoffPrompt ? { text: milestone.kickoffPrompt, specPath: '' } : null
}

// ─── Core run helper ──────────────────────────────────────────────────────────

async function runDecider(
  projectId: string,
  milestoneId: string,
  isAudit: boolean,
): Promise<DeciderRunResult | null> {
  const settings = getDeciderSettings()
  if (!settings.enabled) return null

  const project = listProjects().find((p) => p.id === projectId)
  if (!project) return null

  console.log(`[decider-orchestrator] starting ${isAudit ? 'audit' : 'preflight'} for ${milestoneId}`)

  const specInfo = loadSpecInfo(project.path, milestoneId)
  if (!specInfo) {
    console.warn('[decider-orchestrator] no spec text for', milestoneId)
    return null
  }

  const context = bundleContext(project.path, specInfo.text)

  const result = await runDeciderAgent({
    projectPath: project.path,
    projectId,
    context,
    model: settings.model,
  })

  if (!result) return null

  const file: DecisionsFile = {
    milestoneId,
    specPath: specInfo.specPath,
    generatedAt: Date.now(),
    clarifiedSpec: result.clarifiedSpec,
    decisions: result.decisions,
    isAudit,
  }

  const filePath = saveDecisions(project.path, file)
  return { ...result, decisionFilePath: filePath }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pre-flight: run before a build to resolve ambiguities in the spec.
 * Called from driveRun() in phase-runner.ts and from the IPC handler.
 * Returns null if Decider is disabled or if the run fails (graceful degradation).
 */
export async function runPreflightDecider(
  projectId: string,
  milestoneId: string,
): Promise<DeciderRunResult | null> {
  try {
    return await runDecider(projectId, milestoneId, false)
  } catch (e) {
    console.error('[decider-orchestrator] preflight failed:', e)
    return null
  }
}

/**
 * Audit: run after a build (or manually) to audit decisions made during the build.
 * Called from the review bridge and the IPC handler.
 */
export async function runAuditDecider(
  projectId: string,
  milestoneId: string,
): Promise<DeciderRunResult | null> {
  try {
    return await runDecider(projectId, milestoneId, true)
  } catch (e) {
    console.error('[decider-orchestrator] audit failed:', e)
    return null
  }
}

/**
 * Atomic: unskip a milestone, run pre-flight Decider, return the updated plan
 * and decisions. Used by the renderer's "Resolve with Decider" action on skipped
 * milestones to avoid two separate round-trips with a race condition window.
 */
export async function resolveSkippedWithDecider(
  projectId: string,
  milestoneId: string,
): Promise<{ plan: PhasePlan; decisions: DecisionsFile } | null> {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) return null

  // 1. Unskip the milestone
  const updatedPlan = unmarkMilestoneSkipped(project.path, milestoneId)
  if (!updatedPlan) {
    console.warn('[decider-orchestrator] could not unskip', milestoneId)
    return null
  }

  // 2. Run pre-flight (gracefully degrade on failure — the unskip already committed).
  const result = await runPreflightDecider(projectId, milestoneId)
  if (!result) {
    // Decider failed: return the updated plan with an empty sentinel so the caller
    // still reloads the now-unskipped plan in the renderer.
    const emptyFile: DecisionsFile = {
      milestoneId,
      specPath: '',
      generatedAt: Date.now(),
      clarifiedSpec: '',
      decisions: [],
      isAudit: false,
    }
    return { plan: updatedPlan, decisions: emptyFile }
  }

  // 3. Prefer the persisted file (it has filePath set); fall back to the in-memory
  // result so the caller always gets the unskipped plan even if disk read fails.
  const persisted = loadDecisions(project.path, milestoneId, false)
  return {
    plan: updatedPlan,
    decisions: persisted ?? {
      milestoneId,
      specPath: '',
      generatedAt: Date.now(),
      clarifiedSpec: result.clarifiedSpec,
      decisions: result.decisions,
      isAudit: false,
    },
  }
}

/**
 * Build the starter message for a "Review decisions in CC" session.
 */
export function buildReviewPrompt(
  projectId: string,
  milestoneId: string,
): { starterMessage: string; decisionFilePaths: string[] } | null {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) return null

  const filePaths = getDecisionsFilePaths(project.path, milestoneId)
  if (filePaths.length === 0) return null

  const plan = loadPhasePlan(project.path)
  const milestone = plan ? getMilestoneById(plan, milestoneId) : null
  const name = milestone?.text ?? milestoneId

  const fileList = filePaths.map((p) => `- ${p}`).join('\n')
  const starterMessage = [
    `I'd like to review the Decider decisions for milestone: **${name}**`,
    '',
    'Decision files:',
    fileList,
    '',
    'Please read these files and explain the key decisions, especially any marked medium or high risk. Flag anything that looks wrong or that I should reconsider.',
  ].join('\n')

  return { starterMessage, decisionFilePaths: filePaths }
}
