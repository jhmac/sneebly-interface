import { existsSync, realpathSync } from 'node:fs'
import { resolve, relative, dirname, basename, join } from 'node:path'

export function resolveAndValidate(filePath: string, repoRoot: string): { relative: string; valid: boolean } {
  const resolved = resolve(repoRoot, filePath)
  let realResolved: string
  try {
    const parentDir = dirname(resolved)
    if (existsSync(parentDir)) {
      realResolved = join(realpathSync(parentDir), basename(resolved))
    } else {
      realResolved = resolved
    }
  } catch {
    realResolved = resolved
  }
  const rel = relative(repoRoot, realResolved)
  const valid = !rel.startsWith('..') && !rel.startsWith('/')
  return { relative: rel, valid }
}

export function matchesPathList(rel: string, patterns: string[]): boolean {
  return patterns.some(p => {
    const cleaned = p.replace(/\/?\*\*$/, '').replace(/\*$/, '')
    if (!cleaned) return true
    return rel === cleaned || rel.startsWith(cleaned.endsWith('/') ? cleaned : cleaned + '/')
  })
}

export function isPathSafe(filePath: string, safePaths: string[], protectedPaths: string[], repoRoot: string): boolean {
  const { relative: rel, valid } = resolveAndValidate(filePath, repoRoot)
  if (!valid) return false
  if (matchesPathList(rel, protectedPaths)) return false
  if (matchesPathList(rel, safePaths)) return true
  return false
}

export function parseSafePaths(agentsContent: string): string[] {
  const m = agentsContent.match(/## Safe Paths[\s\S]*?```\n([\s\S]*?)```/)
  if (!m) return []
  return m[1]!.trim().split('\n').map(l => l.trim()).filter(Boolean)
}

export function parseProtectedPaths(agentsContent: string): string[] {
  const m = agentsContent.match(/## Protected Paths[\s\S]*?```\n([\s\S]*?)```/)
  if (!m) return []
  return m[1]!.trim().split('\n').map(l => l.trim()).filter(Boolean)
}
