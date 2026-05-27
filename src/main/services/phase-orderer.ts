import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { runStandaloneTurn, extractJson } from './standalone-turn'
import { parseMilestones } from './spec/milestone-parser'
import type { PhasePlan, OrderedMilestone, MilestoneComplexity } from '../../shared/types'

const ORDERER_SYSTEM_PROMPT = `You are a senior software engineer and technical project manager. You will be given a project's GOALS.md and all its spec files. Your job is to analyze the features and produce an optimal build order based on:

1. Technical dependencies (auth before protected routes, DB schema before API, API before UI)
2. Risk management (hard/uncertain work early while the team has maximum options)
3. Value delivery (features that unlock other features come first)
4. Testing feasibility (testable slices before untestable ones)
5. External API dependencies (stubs before live integrations)

For each milestone you must produce:
- complexity: "low" | "medium" | "high" based on: number of files touched, external dependencies, algorithmic difficulty, integration surface
- suggestedCheckpoint: true if this is a good place to pause and manually verify before continuing (true for: first working version of a major system, anything touching payments/auth/real APIs, high-complexity items)
- checkpointReason: one sentence explaining why (null if suggestedCheckpoint is false)
- rationale: one sentence on why this milestone is ordered here
- dependencies: array of milestone IDs (p<num>-m<idx> format) this milestone depends on
- kickoffPrompt: a precise chat message to send Sneebly to start building this milestone. Include: the milestone name, the relevant spec file via @file if one exists, acceptance criteria from the spec, and any critical constraints
- testChecklist: 3-6 items the developer should manually verify after the feature is built (things that can't easily be automated: real API calls, device hardware, visual polish, edge cases requiring live data)

Respond with ONLY valid JSON in this exact shape:
{
  "buildSummary": "<2-3 sentence strategy overview explaining the overall build approach>",
  "milestones": [
    {
      "id": "<original id>",
      "complexity": "low|medium|high",
      "suggestedCheckpoint": true|false,
      "checkpointReason": "<string or null>",
      "rationale": "<string>",
      "dependencies": ["<id>", ...],
      "kickoffPrompt": "<full chat message>",
      "testChecklist": ["<item>", ...]
    },
    ...
  ]
}

The milestones array must contain every milestone from the input, reordered by your recommended build sequence. Preserve the original id values exactly.`

interface RawOrderEntry {
  id: string
  complexity: MilestoneComplexity
  suggestedCheckpoint: boolean
  checkpointReason: string | null
  rationale: string | null
  dependencies: string[]
  kickoffPrompt: string
  testChecklist: string[]
}

interface RawAgentOutput {
  buildSummary: string
  milestones: RawOrderEntry[]
}

function readSpecFiles(projectPath: string): string {
  const specsDir = join(projectPath, 'specs')
  if (!existsSync(specsDir)) return ''
  const parts: string[] = []
  for (const f of readdirSync(specsDir)) {
    if (!f.endsWith('.md') && !f.endsWith('.MD')) continue
    try {
      const content = readFileSync(join(specsDir, f), 'utf-8')
      parts.push(`\n\n=== ${f} ===\n${content.slice(0, 8_000)}`)
    } catch { /* skip unreadable */ }
  }
  return parts.join('')
}

function stableId(phaseNumber: number, milestoneIndex: number): string {
  return `p${phaseNumber}-m${milestoneIndex}`
}

export async function generatePhasePlan(
  projectPath: string,
  projectId: string
): Promise<PhasePlan> {
  const goalsPath = join(projectPath, 'GOALS.md')
  if (!existsSync(goalsPath)) throw new Error('GOALS.md not found in project')

  const goalsMd = readFileSync(goalsPath, 'utf-8')
  const milestones = parseMilestones(goalsMd)
  const specContent = readSpecFiles(projectPath)

  // Build stable IDs — phase-orderer uses these; milestone-parser gives us phase numbers
  const milestonesWithIds = milestones.map((m, i) => {
    const phaseMatch = m.phase.match(/Phase\s+(\d+)/i)
    const phaseNum = phaseMatch ? parseInt(phaseMatch[1]!, 10) : 0
    return { ...m, stableId: stableId(phaseNum, i), phaseNum }
  })

  const inputPayload = milestonesWithIds.map((m) => ({
    id: m.stableId,
    phase: m.phase,
    text: m.text,
    checked: m.checked,
    specPath: m.specPath,
  }))

  const prompt = `GOALS.md:\n${goalsMd.slice(0, 6_000)}${specContent}\n\n---\nMilestones to order (JSON):\n${JSON.stringify(inputPayload, null, 2)}`

  const model = milestones.length > 30 ? 'claude-opus-4-7' : 'claude-sonnet-4-6'

  const result = await runStandaloneTurn({
    cwd: projectPath,
    projectId,
    prompt,
    model,
    permissionMode: 'default',
    allowedTools: [],
    appendSystemPrompt: ORDERER_SYSTEM_PROMPT,
    maxTurns: 1,
  })

  if (result.error) throw new Error(`Phase orderer agent failed: ${result.error}`)
  const parsed = extractJson<RawAgentOutput>(result.assistantText)
  if (!parsed || !Array.isArray(parsed.milestones)) {
    throw new Error(
      `Phase orderer returned no parseable JSON (${result.assistantText.length} chars): ${result.assistantText.slice(0, 200)}`
    )
  }

  // Merge agent output with source milestone data
  const sourceById = new Map(milestonesWithIds.map((m) => [m.stableId, m]))

  const ordered: OrderedMilestone[] = parsed.milestones.map((entry, idx) => {
    const src = sourceById.get(entry.id)
    if (!src) throw new Error(`Unknown milestone id "${entry.id}" returned by orderer`)
    return {
      id: entry.id,
      text: src.text,
      phase: src.phase,
      phaseNumber: src.phaseNum,
      specPath: src.specPath,
      checked: src.checked,
      skipped: src.skipped,
      skipReason: src.skipReason,
      buildOrder: idx,
      complexity: entry.complexity ?? 'medium',
      suggestedCheckpoint: entry.suggestedCheckpoint ?? false,
      checkpointReason: entry.checkpointReason ?? null,
      rationale: entry.rationale ?? null,
      dependencies: entry.dependencies ?? [],
      kickoffPrompt: entry.kickoffPrompt ?? `Build: ${src.text}`,
      testChecklist: entry.testChecklist ?? [],
    }
  })

  return {
    projectPath,
    generatedAt: Date.now(),
    modelUsed: model,
    buildSummary: parsed.buildSummary ?? '',
    milestones: ordered,
  }
}
