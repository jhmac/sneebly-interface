import Store from 'electron-store'
import { join } from 'path'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { PhaseRunConfig, PhaseRunState, ChatMessage, ModelName, OrderedMilestone } from '../../shared/types'
import { isChatTurnInFlight, startTurn, turnEmitter, type TurnMetrics } from './agent-session'
import {
  loadPhasePlan,
  getMilestoneById,
  getNextMilestone,
  syncCheckedState,
  markMilestoneComplete,
  markMilestoneSkipped,
} from './phase-tracker'
import { listProjects } from './project-registry'
import { composeSystemPromptAddendum } from './system-prompt-composer'
import { sendToProjectWindows } from './window-registry'
import * as sessionStore from './session-store'
import { pushAgentEvent } from '../ipc/agent'
import { getServerUrl } from './dev-server'
import { runBrowserCheck } from '../mcp-servers/browser-check/browser'
import { appendEvent } from './event-stream'
import { runPlaywrightVerification } from './phase-playwright-runner'
import { fireReview } from './review-agent'
import { runPreflightDecider } from './decider-orchestrator'
import { runSpecAcceptor } from './spec-acceptor-orchestrator'

const execFileAsync = promisify(execFile)
const GIT_MAX_BUFFER = 16 * 1024 * 1024  // porcelain output can be large for codegen-heavy milestones

const store = new Store()

// Per-project run state
const runStates = new Map<string, PhaseRunState>()

// Per-project last-used run config — retained so skipCurrentMilestone can continue
// the run with the same batch settings the user configured.
const lastRunConfigs = new Map<string, PhaseRunConfig>()

const UI_FILE_EXTENSIONS = new Set([
  '.tsx', '.jsx', '.vue', '.svelte', '.html', '.htm', '.css', '.scss', '.sass', '.less',
])

function isUIMilestone(metrics: TurnMetrics | undefined): boolean {
  if (!metrics) return false
  return metrics.filesTouched.some((fp) => {
    const dot = fp.lastIndexOf('.')
    if (dot === -1) return false
    return UI_FILE_EXTENSIONS.has(fp.slice(dot).toLowerCase())
  })
}

interface SmokeTestResult {
  passed: boolean
  reason?: string
  consoleErrors: string[]
  failedRequests: string[]
}

async function runSmokeTest(projectId: string): Promise<SmokeTestResult | null> {
  const url = getServerUrl(projectId)
  if (!url) return null

  try {
    const result = await runBrowserCheck({ url, waitFor: 'networkidle', timeoutMs: 15_000 })

    const consoleErrors = result.consoleMessages
      .filter((m) => m.level === 'error')
      .map((m) => m.text)

    const failedRequests = result.networkRequests
      .filter((r) => r.status !== undefined && r.status >= 400 && !r.url.includes('favicon'))
      .map((r) => `${r.status} ${r.url}`)

    const hasFatalErrors = consoleErrors.some((e) =>
      /Uncaught|TypeError|ReferenceError|SyntaxError|Cannot read/i.test(e)
    )

    if (result.rootChildren === 0) {
      return {
        passed: false,
        reason: 'React root has no children (page did not render)',
        consoleErrors,
        failedRequests,
      }
    }
    if (hasFatalErrors) {
      return {
        passed: false,
        reason: `Fatal console errors: ${consoleErrors.slice(0, 3).join(' | ')}`,
        consoleErrors,
        failedRequests,
      }
    }
    if (failedRequests.length > 0) {
      return {
        passed: false,
        reason: `Failed asset requests: ${failedRequests.slice(0, 3).join(' | ')}`,
        consoleErrors,
        failedRequests,
      }
    }

    return { passed: true, consoleErrors, failedRequests }
  } catch (e) {
    console.error('[phase-runner] smoke test failed to execute:', e)
    return null
  }
}

// Parse `git status --porcelain=v1 -z` output into a set of paths (relative to repo root).
// -z entries are NUL-separated, format "XY path"; rename/copy entries are followed by a
// second NUL field carrying the original path, which we consume and ignore.
function parsePorcelainZ(out: string): Set<string> {
  const paths = new Set<string>()
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]
    if (!entry || entry.length < 4) continue
    const xy = entry.slice(0, 2)
    paths.add(entry.slice(3))
    // Rename/copy: the next field is the original path — skip it.
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') i++
  }
  return paths
}

async function gitStatusBaseline(projectPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: GIT_MAX_BUFFER,
    })
    return parsePorcelainZ(stdout)
  } catch {
    // Not a git repo, or git not installed — auto-commit will skip.
    return new Set()
  }
}

interface AutoCommitResult {
  committed: boolean
  hash?: string
  filesIncluded: number
  reason?: string
}

async function autoCommitMilestone(
  projectPath: string,
  milestone: OrderedMilestone,
  buildMetrics: TurnMetrics | undefined,
  preBuildDirtyFiles: Set<string>,
): Promise<AutoCommitResult> {
  // The .git existence check also guarantees projectPath is the repo root, so porcelain
  // paths and normalized filesTouched paths are both relative to projectPath.
  if (!existsSync(join(projectPath, '.git'))) {
    return { committed: false, filesIncluded: 0, reason: 'no git repo' }
  }

  try {
    const { stdout: current } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: projectPath, encoding: 'utf-8', timeout: 30_000, maxBuffer: GIT_MAX_BUFFER,
    })

    // Normalize Claude's filesTouched (absolute) to repo-root-relative.
    const touchedByClaude = new Set<string>()
    for (const absPath of buildMetrics?.filesTouched ?? []) {
      if (absPath.startsWith(projectPath + '/')) {
        touchedByClaude.add(absPath.slice(projectPath.length + 1))
      } else if (!absPath.startsWith('/')) {
        touchedByClaude.add(absPath)
      }
      // Paths outside the project are ignored — not part of this repo.
    }

    const filesToStage: string[] = []
    for (const path of parsePorcelainZ(current)) {
      // Never sweep Sneebly's own internal state into the milestone commit.
      if (path.startsWith('.sneebly-interface/')) continue
      // GOALS.md always — markMilestoneComplete just flipped its checkmark.
      if (path === 'GOALS.md' || path.endsWith('/GOALS.md')) { filesToStage.push(path); continue }
      // Files Claude wrote/edited this turn.
      if (touchedByClaude.has(path)) { filesToStage.push(path); continue }
      // Pre-existing dirty files Claude didn't touch = user's unrelated work — leave them.
      if (preBuildDirtyFiles.has(path)) continue
      // Newly dirty during this milestone (Bash deletions, codegen output, etc.) — include.
      filesToStage.push(path)
    }

    if (filesToStage.length === 0) {
      return { committed: false, filesIncluded: 0, reason: 'no files to stage' }
    }

    await execFileAsync('git', ['add', '--', ...filesToStage], {
      cwd: projectPath, timeout: 30_000,
    })

    // Gitignored matches won't stage — bail if nothing is actually staged.
    const { stdout: stagedCheck } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
      cwd: projectPath, encoding: 'utf-8', timeout: 30_000, maxBuffer: GIT_MAX_BUFFER,
    })
    if (!stagedCheck.trim()) {
      return { committed: false, filesIncluded: 0, reason: 'all matched files gitignored' }
    }

    const subject = `[${milestone.id}] ${milestone.text}`.slice(0, 100)
    const kickoffSummary = milestone.kickoffPrompt.slice(0, 200).replace(/\n/g, ' ')
    const body = [
      'Autonomous build by Sneebly phase runner.',
      `Files committed: ${filesToStage.length}`,
      `Kickoff: ${kickoffSummary}${milestone.kickoffPrompt.length > 200 ? '…' : ''}`,
      '',
      'Co-Authored-By: Sneebly Phase Runner <runner@sneebly.local>',
    ].join('\n')

    await execFileAsync('git', ['commit', '-m', subject, '-m', body], {
      cwd: projectPath, timeout: 30_000,
    })

    const { stdout: hash } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: projectPath, encoding: 'utf-8', timeout: 30_000,
    })

    return { committed: true, hash: hash.trim(), filesIncluded: filesToStage.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { committed: false, filesIncluded: 0, reason: `git error: ${msg}` }
  }
}

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
  console.log(`[phase-runner] startRun batchSize=${config.batchSize} startFrom=${config.startFromMilestoneId}`)
  const existing = runStates.get(projectId)
  if (existing && existing.status === 'building') {
    throw new Error('A phase run is already in progress for this project')
  }
  // A paused run is resumable — reset to idle so the guard above doesn't block.
  if (existing?.status === 'paused') {
    setRunState(projectId, { ...idleState(), status: 'idle' })
  }

  const project = listProjects().find((p) => p.id === projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)

  let plan = loadPhasePlan(project.path)
  if (!plan) throw new Error('No phase plan found — generate one first')

  plan = syncCheckedState(project.path, plan)

  // Persist config so skipCurrentMilestone can resume with the same settings
  lastRunConfigs.set(projectId, config)

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

  // Snapshot dirty files before the build so auto-commit can exclude the user's pre-existing work.
  const preBuildDirtyFiles = await gitStatusBaseline(project.path)

  // ── Autonomous Decider (pre-flight) ──────────────────────────────────────────
  // Resolve spec ambiguities before the build. runPreflightDecider catches all
  // internal errors and returns null on any failure, so the outer catch here only
  // guards against the unlikely case of sendToProjectWindows throwing.
  // In all failure modes we fall back to the original kickoff — the build is never blocked.
  let effectiveKickoff = milestone.kickoffPrompt
  try {
    const deciderResult = await runPreflightDecider(projectId, milestoneId)
    if (deciderResult?.clarifiedSpec) {
      effectiveKickoff = deciderResult.clarifiedSpec
      // Signal the renderer to refresh its badge count.
      sendToProjectWindows(projectId, IPC_CHANNELS.DECIDER_DECISIONS_UPDATED, projectId)
    }
  } catch (err) {
    console.warn('[phase-runner] unexpected error in Decider hook, using original kickoff:', err)
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Get or create a session
  const sessionId = getOrCreateSessionId(projectId, project.path)

  // Build the user message (kickoff prompt).
  // Chat display always shows the original kickoff prompt; the Decider-clarified
  // version is passed only to CC (startTurn) so the user sees what they approved.
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
        // Use the Decider-clarified kickoff if available; falls back to the original.
        prompt: effectiveKickoff,
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
          console.log(`[phase-runner] pausing — build error on ${milestoneId}: ${error}`)
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
    console.log(`[phase-runner] pausing — silent failure on ${milestoneId} (no file changes)`)
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

  // UI smoke test: verify the page actually renders after a UI milestone
  if (isUIMilestone(buildMetrics) && appSettings['runUISmokeTests'] !== false) {
    const smokeResult = await runSmokeTest(projectId)
    if (getRunState(projectId).status !== 'building') return  // stopped during smoke test

    appendEvent(project.path, sessionId, {
      id: crypto.randomUUID(),
      sessionId,
      projectId,
      ts: Date.now(),
      kind: 'phase_runner_smoke_test',
      source: 'chat',
      payload: {
        milestoneId,
        passed: smokeResult?.passed ?? null,
        skipped: smokeResult === null,
        reason: smokeResult?.reason ?? null,
        consoleErrors: smokeResult?.consoleErrors ?? [],
        failedRequests: smokeResult?.failedRequests ?? [],
      },
    })

    if (smokeResult === null) {
      console.warn('[phase-runner] smoke test skipped — dev server not running or browser check failed')
    } else if (!smokeResult.passed) {
      console.log(`[phase-runner] pausing — smoke test failed on ${milestoneId}: ${smokeResult.reason}`)
      setRunState(projectId, {
        ...getRunState(projectId),
        status: 'paused',
        lastError: `UI smoke test failed: ${smokeResult.reason ?? 'unknown'}`,
      })
      return
    }
  }

  // ── Spec Acceptor gate ──────────────────────────────────────────────────────
  // Verify the implementation satisfies the spec before marking done.
  // runSpecAcceptor returns null when disabled, when there is no spec, or on any
  // agent/parse failure — null is treated as pass-through in every branch below,
  // so builds are never blocked by acceptor failures. The enabled/disabled check
  // lives inside the orchestrator; no need to duplicate it here.
  //
  // If the first check fails, one targeted fix turn runs (same CC session so
  // Claude has full build context), then we re-verify. Still failing after the
  // fix → pause; the milestone is NOT marked complete until a human resolves it.
  const changedFiles = buildMetrics?.filesTouched ?? []
  let acceptorResult = await runSpecAcceptor(projectId, milestoneId, changedFiles)

  if (acceptorResult && !acceptorResult.pass) {
    console.log(`[phase-runner] spec acceptor FAIL for ${milestoneId} — running fix turn`)

    // Targeted fix turn: same session, Opus model, spec-specific issues only.
    const fixClaudeId = store.get(`claudeSessionIds.${sessionId}`, null) as string | null
    const issueList = acceptorResult.issues.map((i) => `- ${i}`).join('\n')
    const fixMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: [
        `[Spec acceptor] Your implementation of "${milestone.text}" is missing these requirements:`,
        issueList,
        `Fix each issue above. Focus only on what is listed — do not change anything else.`,
      ].join('\n\n'),
      ts: Date.now(),
    }
    sessionStore.appendMessage(project.path, sessionId, fixMsg)
    sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, fixMsg)
    sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: true })

    await new Promise<void>((resolve) => {
      startTurn(
        {
          cwd: project.path,
          projectId,
          sneeblySessionId: sessionId,
          claudeCodeSessionId: fixClaudeId,
          prompt: fixMsg.text,
          model: escalationModel,
          appendSystemPrompt: systemPromptAddendum ?? undefined,
          recordEvents,
          recordUsage,
        },
        (event) => { pushAgentEvent(event, projectId) },
        (newClaudeId, _fixError) => {
          sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: false })
          if (newClaudeId) store.set(`claudeSessionIds.${sessionId}`, newClaudeId)
          // Fix turn errors don't block re-verify — resolve regardless.
          resolve()
        }
      )
    })

    if (getRunState(projectId).status !== 'building') return

    // Re-verify with the same changedFiles hint list. This is correct: the agent
    // reads files from disk via the Read tool, so it sees the post-fix state even
    // though the hint list reflects the original build's touched files. Any new
    // files written by the fix turn will be found by Grep if needed.
    acceptorResult = await runSpecAcceptor(projectId, milestoneId, changedFiles)

    if (acceptorResult && !acceptorResult.pass) {
      const firstIssue = acceptorResult.issues[0] ?? ''
      const errorMsg = `Spec acceptor: ${acceptorResult.summary}${firstIssue ? ` — ${firstIssue}` : ''}`
      console.log(`[phase-runner] pausing — spec acceptor still failing after fix on ${milestoneId}: ${errorMsg}`)
      setRunState(projectId, {
        ...getRunState(projectId),
        status: 'paused',
        lastError: errorMsg,
      })
      return
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Mark the milestone complete: build passed, review passed, smoke test passed,
  // and the spec acceptor confirmed the implementation satisfies the spec.
  markMilestoneComplete(project.path, milestoneId)

  // Auto-commit the milestone's changes so the run is traceable in git history.
  if (appSettings['autoCommitMilestones'] !== false) {
    const commitResult = await autoCommitMilestone(project.path, milestone, buildMetrics, preBuildDirtyFiles)

    // Record the outcome regardless — the commit (if made) is durable and git is the
    // source of truth, so the event stream should reflect it even if the user stopped.
    appendEvent(project.path, sessionId, {
      id: crypto.randomUUID(),
      sessionId,
      projectId,
      ts: Date.now(),
      kind: 'phase_runner_auto_commit',
      source: 'chat',
      payload: {
        milestoneId,
        committed: commitResult.committed,
        hash: commitResult.hash ?? null,
        filesIncluded: commitResult.filesIncluded,
        reason: commitResult.reason ?? null,
      },
    })

    if (commitResult.committed) {
      console.log(`[phase-runner] auto-committed ${milestoneId} as ${commitResult.hash} (${commitResult.filesIncluded} files)`)
    } else {
      console.warn(`[phase-runner] auto-commit skipped for ${milestoneId}: ${commitResult.reason}`)
    }

    // A Stop during the (async) commit must not be overwritten by the advance logic below.
    if (getRunState(projectId).status !== 'building') return
  }

  // Auto-fire the Review Agent (log-only, fire-and-forget). Placed after the auto-commit
  // so the review can diff the isolated [milestoneId] commit instead of the whole tree.
  // fireReview self-gates on settings (enabled + autoFire); the run never waits on it.
  try { fireReview(projectId, milestoneId, true) } catch (err) {
    console.warn('[phase-runner] auto-fire review failed to start:', err)
  }

  // Playwright checklist test (best-effort — failures surface as warnings, don't pause)
  if (
    isUIMilestone(buildMetrics) &&
    appSettings['runPlaywrightChecklistTests'] === true &&
    milestone.testChecklist.length > 0
  ) {
    const devServerUrl = getServerUrl(projectId)
    if (devServerUrl) {
      const playwrightResult = await runPlaywrightVerification(
        project.path,
        projectId,
        milestoneId,
        milestone.text,
        milestone.testChecklist,
        devServerUrl,
        escalationModel as ModelName,
      )
      if (playwrightResult) {
        if (getRunState(projectId).status !== 'building') return  // stopped during Playwright run

        appendEvent(project.path, sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          projectId,
          ts: Date.now(),
          kind: playwrightResult.passed ? 'phase_runner_playwright_passed' : 'phase_runner_playwright_failed',
          source: 'chat',
          payload: {
            milestoneId,
            ...(playwrightResult.passed
              ? {}
              : {
                  failureDetails: playwrightResult.failureDetails,
                  output: playwrightResult.output.slice(0, 2000),
                }),
          },
        })

        if (!playwrightResult.passed) {
          const specRelPath = join('.sneebly-interface', 'playwright-tests', `${milestoneId}.spec.ts`)
          const warningMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `Playwright tests reported failures for milestone "${milestone.text}". Review the generated spec at \`${specRelPath}\`.\n\n${(playwrightResult.failureDetails ?? playwrightResult.output).slice(0, 500)}`,
            ts: Date.now(),
          }
          sessionStore.appendMessage(project.path, sessionId, warningMsg)
          sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, warningMsg)
        }
      }
    }
  }

  // Advance
  const completedInBatch = stateAfterBuild.completedInBatch + 1
  const batchSize = stateAfterBuild.batchSize

  console.log(`[phase-runner] milestone ${milestoneId} done — completedInBatch=${completedInBatch} batchSize=${batchSize}`)

  setRunState(projectId, {
    ...stateAfterBuild,
    completedInBatch,
    activeChecklist: milestone.testChecklist,
  })

  // Pause if the batch limit is reached.
  // batchSize -1 = all remaining (no limit); 0 = until next checkpoint; >0 = exact count.
  const hitBatchLimit = batchSize > 0 && completedInBatch >= batchSize
  const hitCheckpoint = batchSize === 0 && milestone.suggestedCheckpoint

  console.log(`[phase-runner] batch check — hitBatchLimit=${hitBatchLimit} hitCheckpoint=${hitCheckpoint} checkpoint=${milestone.suggestedCheckpoint}`)

  if (hitBatchLimit || hitCheckpoint) {
    console.log(`[phase-runner] pausing after ${milestoneId} (hitBatchLimit=${hitBatchLimit} hitCheckpoint=${hitCheckpoint})`)
    setRunState(projectId, {
      ...getRunState(projectId),
      status: 'paused',
      currentMilestoneId: milestoneId,
    })
    return
  }

  // Find next unchecked, non-skipped milestone in build order
  const syncedPlan = syncCheckedState(project.path, loadPhasePlan(project.path)!)
  const currentIdx = syncedPlan.milestones.findIndex((m) => m.id === milestoneId)
  const nextMilestone = syncedPlan.milestones.slice(currentIdx + 1).find((m) => !m.checked && !m.skipped)

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

// Skip the currently-paused milestone and advance the run to the next buildable one.
// Annotates GOALS.md with "(skipped: <reason>)" and resumes the autonomous loop.
export async function skipCurrentMilestone(projectId: string): Promise<void> {
  const state = getRunState(projectId)
  if (state.status !== 'paused' || !state.currentMilestoneId) {
    throw new Error('No paused milestone to skip')
  }

  const project = listProjects().find((p) => p.id === projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)

  const milestoneId = state.currentMilestoneId

  // Use the pause reason as the skip reason so the annotation is self-explanatory
  const reason = state.lastError
    ? state.lastError.slice(0, 120)
    : 'deferred during autonomous run'

  markMilestoneSkipped(project.path, milestoneId, reason)

  // Re-sync and find the next buildable milestone
  const plan = loadPhasePlan(project.path)
  if (!plan) { stopRun(projectId); return }
  const syncedPlan = syncCheckedState(project.path, plan)

  const currentIdx = syncedPlan.milestones.findIndex((m) => m.id === milestoneId)
  const nextMilestone = syncedPlan.milestones
    .slice(currentIdx + 1)
    .find((m) => !m.checked && !m.skipped)

  if (!nextMilestone) {
    setRunState(projectId, { ...getRunState(projectId), status: 'complete' })
    return
  }

  const config = lastRunConfigs.get(projectId) ?? {
    batchSize: 0,
    startFromMilestoneId: nextMilestone.id,
    autoReview: true,
  }

  setRunState(projectId, {
    status: 'building',
    currentMilestoneId: nextMilestone.id,
    completedInBatch: state.completedInBatch,
    batchSize: state.batchSize,
    activeChecklist: nextMilestone.testChecklist,
    lastError: null,
  })

  driveRun(projectId, config, nextMilestone.id).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    setRunState(projectId, { ...getRunState(projectId), status: 'paused', lastError: msg })
  })
}
