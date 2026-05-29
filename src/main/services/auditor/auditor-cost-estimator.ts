import type { AuditableFile, AuditEstimate, AuditScope, ModelName } from '../../../shared/types'

// Prices in USD per million tokens (update if Anthropic changes pricing)
const SONNET_INPUT_PER_M = 3
const SONNET_OUTPUT_PER_M = 15

// Overhead per LLM call
const SYSTEM_PROMPT_TOKENS = 600   // approximate tokens in each system prompt
const RESPONSE_OVERHEAD_TOKENS = 400

// Output/input ratio: Claude usually outputs ~30% of the input size for audit passes
const OUTPUT_RATIO = 0.3

// Batching gives roughly 30% savings on small files
const BATCH_SAVINGS = 0.3

function fileCostUsd(sizeBytes: number, pricePerMInput: number, pricePerMOutput: number): number {
  const inputTokens = SYSTEM_PROMPT_TOKENS + (sizeBytes / 3) + RESPONSE_OVERHEAD_TOKENS
  const outputTokens = inputTokens * OUTPUT_RATIO
  return (inputTokens / 1_000_000) * pricePerMInput +
         (outputTokens / 1_000_000) * pricePerMOutput
}

export function estimateAudit(
  files: AuditableFile[],
  scope: AuditScope,
  model: ModelName,
  costCeilingUsd: number,
): AuditEstimate {
  const inputPrice = model === 'claude-opus-4-8' ? 15 : SONNET_INPUT_PER_M
  const outputPrice = model === 'claude-opus-4-8' ? 75 : SONNET_OUTPUT_PER_M

  const sourceFiles = files.filter((f) => f.category === 'source')
  const schemaFiles = files.filter((f) => f.category === 'schema')
  const securityFiles = files.filter(
    (f) => f.category === 'source' && f.importance === 'high',
  )

  const byImportance = {
    high: files.filter((f) => f.importance === 'high').length,
    medium: files.filter((f) => f.importance === 'medium').length,
    low: files.filter((f) => f.importance === 'low').length,
  }

  // Phase 2: code review — all source files
  let phase2CostBase = 0
  let totalTokens = 0
  if (scope.codeReview) {
    for (const f of sourceFiles) {
      phase2CostBase += fileCostUsd(f.sizeBytes, inputPrice, outputPrice)
      totalTokens += SYSTEM_PROMPT_TOKENS + (f.sizeBytes / 3)
    }
  }
  const phase2CostMin = phase2CostBase * (1 - BATCH_SAVINGS)
  const phase2CostMax = phase2CostBase

  // Phase 3: security — high-importance files only (more thorough, less batching)
  let phase3Cost = 0
  if (scope.securityScan) {
    for (const f of securityFiles) {
      phase3Cost += fileCostUsd(f.sizeBytes, inputPrice, outputPrice) * 1.2
      totalTokens += SYSTEM_PROMPT_TOKENS + (f.sizeBytes / 3)
    }
  }

  // Phase 4: schema review
  let phase4Cost = 0
  if (scope.schemaReview) {
    for (const f of schemaFiles) {
      phase4Cost += fileCostUsd(f.sizeBytes, inputPrice, outputPrice)
      totalTokens += SYSTEM_PROMPT_TOKENS + (f.sizeBytes / 3)
    }
  }

  // Phase 5: convention check — sample of source files
  let phase5Cost = 0
  if (scope.conventionCheck) {
    const sampleSize = Math.min(sourceFiles.length, 20)
    for (const f of sourceFiles.slice(0, sampleSize)) {
      phase5Cost += fileCostUsd(f.sizeBytes, inputPrice, outputPrice) * 0.5
    }
    phase5Cost += 0.02 // CLAUDE.md load
    totalTokens += sampleSize * SYSTEM_PROMPT_TOKENS
  }

  // Phase 6: DepSec — small LLM call on npm audit output
  const phase6Cost = scope.dependencySecurityCheck ? 0.01 : 0

  // Buffer (+15%) + safety (+10%)
  const buffer = 1.25

  const subtotalMin = (phase2CostMin + phase3Cost + phase4Cost + phase5Cost + phase6Cost) * buffer
  const subtotalMax = (phase2CostMax + phase3Cost + phase4Cost + phase5Cost + phase6Cost) * buffer

  // Duration estimate: ~3s per file at concurrency 4
  const estimatedDurationMs = Math.ceil((sourceFiles.length / 4) * 3000)

  return {
    fileCount: files.length,
    fileCountByImportance: byImportance,
    estimatedTokens: Math.ceil(totalTokens),
    estimatedDurationMs,
    estimatedCostUsdMin: Math.max(0.01, subtotalMin),
    estimatedCostUsdMax: Math.max(0.01, subtotalMax),
    exceedsCostCeiling: subtotalMax > costCeilingUsd,
  }
}
