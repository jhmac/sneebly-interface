import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { PhaseRunConfig, PhaseRunState, ChatMessage } from '../../shared/types'
import { isChatTurnInFlight, startTurn, turnEmitter, type TurnMetrics } from './agent-session'
import { loadPhasePlan, getMilestoneById, getNextMilestone, syncCheckedState, markMilestoneComplete } from './phase-tracker'
import { listProjects } from './project-registry'
import { composeSystemPromptAddendum } from './system-prompt-composer'
import { sendToProjectWindows } from './window-registry'
import * as sessionStore from './session-store'
import { pushAgentEvent } from '../ipc/agent'

const store = new Store()

// Per-project run state
const runStates = new Map<string, PhaseRunState>()

function idleState(): PhaseRunState {
  return {
    status: 'idle',
    currentMilestoneId: null,
    completedInBatch: 0,
    batchSize: 0,
    activeChecklist: [],
    lastError: null,
  }
}

export function getRunState(projectId: string): PhaseRunState {
  return runStates.get(projectId) ?? idleState()
}

function setRunState(projectId: string, state: PhaseRunState): void {
  runStates.set(projectId, state)
  sendToProjectWindows(projectId, IPC_CHANNELS.PHASE_RUN_STATE_CHANGED, projectId, state)
}

export function stopRun(projectId: string): void {
  const current = runStates.get(projectId)
  if (!current || current.status === 'idle') return
  setRunState(projectId, { ...idleState(), status: 'idle' })
}

export async function startRun(
  projectId: string,
  config: PhaseRunConfig
): Promise<void> {
  const existing = runStates.get(projectId)
  if (existing && existing.status !== 'idle') {
    throw new Error('A phase run is already in progress for this project')
  }

  const project = listProjects().find((p) => p.id === projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)

  let plan = loadPhasePlan(project.path)
  if (!plan) throw new Error('No phase plan found — generate one first')

  plan = syncCheckedState(project.path, plan)

  const startMilestone = config.startFromMilestoneId
    ? getMilestoneById(plan, config.startFromMilestoneId)
    : getNextMilestone(plan)

  if (!startMilestone) {
    setRunState(projectId, { ...idleState(), status: 'complete' })
    return
  }

  setRunState(projectId, {
    status: 'building',
    currentMilestoneId: startMilestone.id,
    completedInBatch: 0,
    batchSize: config.batchSize,
    activeChecklist: startMilestone.testChecklist,
    lastError: null,
  })

  driveRun(projectId, config, startMilestone.id).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    setRunState(projectId, { ...getRunState(projectId), status: 'paused', lastError: msg })
  })
}

async function driveRun(
  projectId: string,
  config: PhaseRunConfig,
  milestoneId: string
): Promise<void> {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) return

  const plan = loadPhasePlan(project.path)
  if (!plan) { stopRun(projectId); return }

  const milestone = getMilestoneById(plan, milestoneId)
  if (!milestone) { stopRun(projectId); return }

  // Wait if a chat turn is in flight (user may be mid-session)
  if (isChatTurnInFlight(projectId)) {
    await waitForTurnEnd(projectId)
  }

  const currentState = getRunState(projectId)
  if (currentState.status !== 'building') return  // stopped externally

  // Get or create a session
  const sessionId = getOrCreateSessionId(projectId, project.path)

  // Build the user message (kickoff prompt)
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    text: milestone.kickoffPrompt,
    ts: Date.now(),
  }
  sessionStore.appendMessage(project.path, sessionId, userMsg)
  sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, userMsg)

  const appSettings = store.get('appSettings', {}) as Record<string, unknown>
  const primaryModel = (appSettings['phaseRunnerPrimaryModel'] as string | undefined) ?? 'claude-sonnet-4-6'
  const escalationModel = (appSettings['phaseRunnerEscalationModel'] as string | undefined) ?? 'claude-opus-4-7'
  const recordEvents = (appSettings['recordEventStream'] as boolean | undefined) ?? true
  const recordUsage = (appSettings['recordTokenUsage'] as boolean | undefined) ?? true
  const claudeCodeSessionId = store.get(`claudeSessionIds.${sessionId}`, null) as string | null

  const { text: systemPromptAddendum } = composeSystemPromptAddendum(project.path, {
    applyLearnings: (appSettings['applyLearnings'] as boolean | undefined) ?? true,
    maxAgeDays: (appSettings['learningsMaxAgeDays'] as number | undefined) ?? 30,
    maxWords: (appSettings['learningsMaxWords'] as number | undefined) ?? 800,
  })

  sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: true })

  let buildError: string | undefined
  let buildMetrics: TurnMetrics | undefined

  await new Promise<void>((resolve) => {
    startTurn(
      {
        cwd: project.path,
        projectId,
        sneeblySessionId: sessionId,
        claudeCodeSessionId,
        prompt: milestone.kickoffPrompt,
        model: primaryModel,
        appendSystemPrompt: systemPromptAddendum ?? undefined,
        recordEvents,
        recordUsage,
      },
      (event) => { pushAgentEvent(event, projectId) },
      (newClaudeId, error, metrics) => {
        sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: false })
        if (newClaudeId) store.set(`claudeSessionIds.${sessionId}`, newClaudeId)
        buildError = error
        buildMetrics = metrics
        if (error) {
          setRunState(projectId, { ...getRunState(projectId), status: 'paused', lastError: error })
        }
        resolve()
      }
    )
  })

  const stateAfterBuild = getRunState(projectId)
  if (stateAfterBuild.status !== 'building') return  // stopped or errored

  // Detect silent failure: no error but Claude made no file changes
  if (!buildError && buildMetrics && buildMetrics.filesTouched.length === 0 && buildMetrics.linesChanged === 0 && !buildMetrics.wasAborted) {
    setRunState(projectId, {
      ...getRunState(projectId),
      status: 'paused',
      lastError: `Build produced no file changes for "${milestone.text}" — milestone may need a more specific kickoff prompt. Use "Build" to refine it manually.`,
    })
    return
  }

  // Auto-review with Opus: re-read what was just built, fix critical issues
  if (config.autoReview) {
    const reviewClaudeId = store.get(`claudeSessionIds.${sessionId}`, null) as string | null
    const reviewMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: `[Auto-review] You just finished building "${milestone.text}". Review your implementation: check for bugs, type errors, security issues, broken imports, and obvious refactoring opportunities. Fix any critical issues you find. Keep the summary brief.`,
      ts: Date.now(),
    }
    sessionStore.appendMessage(project.path, sessionId, reviewMsg)
    sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, reviewMsg)
    sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: true })

    await new Promise<void>((resolve) => {
      startTurn(
        {
          cwd: project.path,
          projectId,
          sneeblySessionId: sessionId,
          claudeCodeSessionId: reviewClaudeId,
          prompt: reviewMsg.text,
          model: escalationModel,
          appendSystemPrompt: systemPromptAddendum ?? undefined,
          recordEvents,
          recordUsage,
          isAutoReview: true,
        },
        (event) => { pushAgentEvent(event, projectId) },
        (newClaudeId, _reviewError) => {
          sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: false })
          if (newClaudeId) store.set(`claudeSessionIds.${sessionId}`, newClaudeId)
          // Review errors don't stop the pipeline — resolve regardless
          resolve()
        }
      )
    })

    // User may have stopped the run during the review
    if (getRunState(projectId).status !== 'building') return
  }

  // Mark the milestone complete after build (and optional review) succeed
  markMilestoneComplete(project.path, milestoneId)

  // Advance
  const completedInBatch = stateAfterBuild.completedInBatch + 1
  const batchSize = stateAfterBuild.batchSize

  setRunState(projectId, {
    ...stateAfterBuild,
    completedInBatch,
    activeChecklist: milestone.testChecklist,
  })

  // Pause if the batch limit is reached.
  // Only treat checkpoints as stop points when batchSize === 0 ("Until next checkpoint" mode).
  const hitBatchLimit = batchSize > 0 && completedInBatch >= batchSize
  const hitCheckpoint = batchSize === 0 && milestone.suggestedCheckpoint

  if (hitBatchLimit || hitCheckpoint) {
    setRunState(projectId, {
      ...getRunState(projectId),
      status: 'paused',
      currentMilestoneId: milestoneId,
    })
    return
  }

  // Find next unchecked milestone in build order
  const syncedPlan = syncCheckedState(project.path, loadPhasePlan(project.path)!)
  const currentIdx = syncedPlan.milestones.findIndex((m) => m.id === milestoneId)
  const nextMilestone = syncedPlan.milestones.slice(currentIdx + 1).find((m) => !m.checked)

  if (!nextMilestone) {
    setRunState(projectId, { ...getRunState(projectId), status: 'complete' })
    return
  }

  setRunState(projectId, {
    ...getRunState(projectId),
    status: 'building',
    currentMilestoneId: nextMilestone.id,
    activeChecklist: nextMilestone.testChecklist,
  })

  driveRun(projectId, config, nextMilestone.id).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    setRunState(projectId, { ...getRunState(projectId), status: 'paused', lastError: msg })
  })
}

function waitForTurnEnd(projectId: string): Promise<void> {
  return new Promise((resolve) => {
    const handler = (data: { projectId: string }) => {
      if (data.projectId === projectId) {
        turnEmitter.off('turn-end', handler)
        resolve()
      }
    }
    turnEmitter.on('turn-end', handler)
  })
}

function getOrCreateSessionId(projectId: string, projectPath: string): string {
  const active = store.get(`chat.activeSession.${projectId}`, null) as string | null
  if (active) return active
  const sessionId = sessionStore.createSession(projectPath)
  store.set(`chat.activeSession.${projectId}`, sessionId)
  return sessionId
}
