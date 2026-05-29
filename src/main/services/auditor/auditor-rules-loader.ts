import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export interface ProjectAuditRules {
  version: 1
  conventionsExtension?: string[]
  highRiskPathPatterns?: string[]
  ignoredFilePatterns?: string[]
  ignoredFindingFingerprints?: string[]
  customSeverityOverrides?: Record<string, 'critical' | 'high' | 'medium' | 'low'>
  requireSchemaForRoutes?: boolean
}

const RULES_PATH = '.sneebly-interface/audit-rules.json'

export function loadAuditRules(projectPath: string): ProjectAuditRules | null {
  const rulesFile = join(projectPath, RULES_PATH)
  if (!existsSync(rulesFile)) return null

  let raw: string
  try { raw = readFileSync(rulesFile, 'utf-8') } catch {
    throw new Error(`audit-rules.json could not be read`)
  }

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (e) {
    throw new Error(`audit-rules.json malformed: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('audit-rules.json must be a JSON object')
  }

  const rules = parsed as Record<string, unknown>
  if (rules['version'] !== 1) {
    throw new Error(`audit-rules.json: unsupported version ${rules['version']} (expected 1)`)
  }

  return rules as unknown as ProjectAuditRules
}
