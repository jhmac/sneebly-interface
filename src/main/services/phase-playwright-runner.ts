import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import type { ModelName } from '../../shared/types'

const execFileAsync = promisify(execFile)

export interface PlaywrightTestResult {
  passed: boolean
  generatedSpec: string
  output: string
  failureDetails?: string
}

const SPEC_GEN_SYSTEM_PROMPT = `You generate Playwright test files for a UI feature. Given a feature description and a checklist of behaviors to verify, output a Playwright test spec.

Requirements:
- Test against the provided base URL
- Use test.describe and test blocks
- Each checklist item becomes one test('...') block
- Use expect for assertions
- Prefer getByRole, getByText, getByLabel over CSS selectors
- Wait for elements with await expect(...).toBeVisible({ timeout: 5000 })
- If a checklist item is unverifiable without manual interaction, output test.skip('...') for that one
- Output ONLY a JSON object: { "spec": "import { test, expect } from '@playwright/test'\\n\\ntest.describe(...) {...}" }
- No prose, no markdown fences`

export async function runPlaywrightVerification(
  projectPath: string,
  projectId: string,
  milestoneId: string,
  milestoneText: string,
  testChecklist: string[],
  devServerUrl: string,
  escalationModel: ModelName
): Promise<PlaywrightTestResult | null> {
  if (testChecklist.length === 0) return null

  const prompt = `Feature: ${milestoneText}

Test checklist:
${testChecklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Generate a Playwright spec that tests each checklist item. Base URL: ${devServerUrl}.
Output ONLY the JSON object.`

  const genResult = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt,
    model: escalationModel,
    permissionMode: 'bypassPermissions',
    appendSystemPrompt: SPEC_GEN_SYSTEM_PROMPT,
    maxTurns: 1,
  })

  const parsed = extractJson<{ spec: string }>(genResult.assistantText)
  if (!parsed?.spec) {
    return {
      passed: false,
      generatedSpec: '',
      output: 'Spec generation failed — model did not return valid JSON',
      failureDetails: genResult.assistantText.slice(0, 500),
    }
  }

  const testsDir = join(projectPath, '.sneebly-interface', 'playwright-tests')
  if (!existsSync(testsDir)) mkdirSync(testsDir, { recursive: true })

  const specPath = join(testsDir, `${milestoneId}.spec.ts`)
  writeFileSync(specPath, parsed.spec, 'utf-8')

  const configContent = `import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  use: { baseURL: '${devServerUrl}', headless: true },
  timeout: 30000,
  reporter: 'line',
})
`
  const configPath = join(testsDir, 'playwright.config.ts')
  writeFileSync(configPath, configContent, 'utf-8')

  // Ensure @playwright/test is available in the user's project
  const playwrightTestBin = join(projectPath, 'node_modules', '.bin', 'playwright')
  const playwrightTestPkg = join(projectPath, 'node_modules', '@playwright', 'test')
  if (!existsSync(playwrightTestPkg)) {
    try {
      await execFileAsync('npm', ['install', '--save-dev', '@playwright/test'], {
        cwd: projectPath,
        timeout: 90_000,
      })
    } catch (installErr) {
      const msg = installErr instanceof Error ? installErr.message : String(installErr)
      return {
        passed: false,
        generatedSpec: parsed.spec,
        output: `Failed to install @playwright/test in project: ${msg}`,
      }
    }
  }

  // Use project-local playwright binary if available, otherwise fall back to npx
  const bin = existsSync(playwrightTestBin) ? playwrightTestBin : 'npx'
  const args = bin === 'npx'
    ? ['playwright', 'test', '--config', configPath, specPath]
    : ['test', '--config', configPath, specPath]

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: projectPath,
      timeout: 90_000,
      shell: false,
    })
    return { passed: true, generatedSpec: parsed.spec, output: stdout + stderr }
  } catch (e) {
    const error = e as { stdout?: string; stderr?: string; message: string }
    return {
      passed: false,
      generatedSpec: parsed.spec,
      output: ((error.stdout ?? '') + (error.stderr ?? '')).slice(0, 4000),
      failureDetails: error.message,
    }
  }
}
