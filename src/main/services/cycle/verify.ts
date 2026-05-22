import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import simpleGit from 'simple-git'
import type { AgentEvent } from '../../../shared/types'
import type { PlanResult } from './plan'
import { reviewDiff } from './review-diff'

export type CheckResult = {
  passed: boolean
  details: string
}

export type VerifyResult = {
  passed: boolean
  checks: {
    types: CheckResult
    criteria: CheckResult
    diffReview: CheckResult
    playwright: CheckResult
  }
}

function runProcess(cmd: string, args: string[], cwd: string, timeoutMs = 90_000): Promise<{ exitCode: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: false, timeout: timeoutMs })
    const chunks: string[] = []
    proc.stdout?.on('data', d => chunks.push(d.toString()))
    proc.stderr?.on('data', d => chunks.push(d.toString()))
    proc.on('close', code => resolve({ exitCode: code ?? 1, out: chunks.join('') }))
    proc.on('error', e => resolve({ exitCode: 1, out: e.message }))
  })
}

async function checkTypes(projectRoot: string, modifiedFiles: string[]): Promise<CheckResult> {
  const tsFiles = modifiedFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
  if (tsFiles.length === 0) return { passed: true, details: 'No TS files modified' }

  const { exitCode, out } = await runProcess('npx', ['tsc', '--noEmit', '--pretty', 'false'], projectRoot, 90_000)
  const errors = out.split('\n').filter(line =>
    tsFiles.some(f => line.includes(basename(f)))
  )
  return {
    passed: errors.length === 0,
    details: errors.length === 0
      ? 'No type errors in modified files'
      : errors.slice(0, 10).join('\n'),
  }
}

function normalizeForCriteria(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[;,]\s*$/, '').trim()
}

function contentMatchesCriterion(content: string, pattern: string): boolean {
  const normPattern = normalizeForCriteria(pattern)
  const normContent = content.split('\n').map(normalizeForCriteria).join('\n')
  return normContent.includes(normPattern)
}

function checkCriteria(plan: PlanResult, projectRoot: string): CheckResult {
  if (!plan.plan || plan.plan.length === 0) return { passed: true, details: 'No criteria to check' }

  const failures: string[] = []
  for (const step of plan.plan) {
    for (const criterion of step.successCriteria) {
      if (criterion.startsWith('file exists:')) {
        const filePath = criterion.replace('file exists:', '').trim()
        const full = join(projectRoot, filePath)
        if (!existsSync(full)) failures.push(`File does not exist: ${filePath}`)
      } else if (criterion.startsWith('file contains:')) {
        const rest = criterion.replace('file contains:', '').trim()
        const colonIdx = rest.lastIndexOf(' in ')
        if (colonIdx !== -1) {
          const pattern = rest.substring(0, colonIdx).trim()
          const filePath = rest.substring(colonIdx + 4).trim()
          const full = join(projectRoot, filePath)
          if (!existsSync(full) || !contentMatchesCriterion(readFileSync(full, 'utf8'), pattern)) {
            failures.push(`File ${filePath} does not contain: ${pattern}`)
          }
        }
      }
    }
  }

  return {
    passed: failures.length === 0,
    details: failures.length === 0 ? 'All success criteria met' : failures.join('\n'),
  }
}

function readPlaywrightEnabled(projectRoot: string): boolean {
  const configPath = join(projectRoot, '.sneebly', 'config.json')
  if (!existsSync(configPath)) return false
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { verifier?: { runPlaywright?: boolean } }
    return config?.verifier?.runPlaywright === true
  } catch { return false }
}

async function isServerUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) })
    return true
  } catch { return false }
}

async function checkPlaywright(projectRoot: string): Promise<CheckResult> {
  if (!readPlaywrightEnabled(projectRoot)) {
    return { passed: true, details: 'Playwright disabled (set verifier.runPlaywright=true in .sneebly/config.json to enable)' }
  }

  const verificationDir = join(projectRoot, '.verification')
  const configPath = join(verificationDir, 'playwright.config.ts')
  if (!existsSync(configPath)) {
    return { passed: true, details: 'No .verification/playwright.config.ts — skipping' }
  }

  const [apiUp, viteUp] = await Promise.all([
    isServerUp('http://localhost:8080/api/me'),
    isServerUp('http://localhost:20054'),
  ])

  if (!apiUp || !viteUp) {
    const missing = [!apiUp && 'api :8080', !viteUp && 'vite :20054'].filter(Boolean).join(', ')
    return { passed: true, details: `Playwright skipped — servers not running (${missing}).` }
  }

  const playwrightBin = join(projectRoot, 'artifacts/plumb/node_modules/.bin/playwright')
  if (!existsSync(playwrightBin)) {
    return { passed: true, details: 'Playwright binary not found — skipping' }
  }

  const { exitCode, out } = await runProcess(playwrightBin, ['test', `--config=${configPath}`], verificationDir, 180_000)
  return {
    passed: exitCode === 0,
    details: exitCode === 0 ? 'Playwright .verification suite passed' : out.slice(-3000),
  }
}

export async function runVerify(
  projectRoot: string,
  projectId: string,
  plan: PlanResult,
  modifiedFiles: string[],
  headBefore: string,
  onEvent?: (event: AgentEvent) => void
): Promise<VerifyResult> {
  const [typesResult, criteriaResult, playwrightResult] = await Promise.all([
    checkTypes(projectRoot, modifiedFiles),
    Promise.resolve(checkCriteria(plan, projectRoot)),
    checkPlaywright(projectRoot),
  ])

  const git = simpleGit(projectRoot)
  let diff = ''
  try { diff = await git.diff([headBefore]) } catch { /* empty diff on error */ }

  const reviewResult = await reviewDiff(projectRoot, projectId, plan, diff, onEvent)
  const diffCheckPassed = reviewResult.implements === 'yes' ||
    (reviewResult.implements === 'partial' && reviewResult.missing.length === 0)

  const diffCheck: CheckResult = {
    passed: diffCheckPassed,
    details: diffCheckPassed
      ? `Diff implements plan: ${reviewResult.reasoning}`
      : `Diff does not fully implement plan. Missing: ${reviewResult.missing.join(', ')}`,
  }

  return {
    passed: typesResult.passed && criteriaResult.passed && diffCheck.passed && playwrightResult.passed,
    checks: { types: typesResult, criteria: criteriaResult, diffReview: diffCheck, playwright: playwrightResult },
  }
}
