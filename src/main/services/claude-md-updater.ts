import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const CONVENTIONS_REF = '<!-- sneebly:conventions-ref -->\nSee `.sneebly-interface/conventions.md` for auto-detected project conventions.'
const CONVENTIONS_MARKER = '<!-- sneebly:conventions-ref -->'

function claudeMdPath(projectPath: string): string {
  return join(projectPath, 'CLAUDE.md')
}

function isSneeblyAuthored(content: string): boolean {
  return content.startsWith('<!-- sneebly-managed -->') || /^# CLAUDE\.md — /m.test(content)
}

function hasConventionsRef(content: string): boolean {
  return content.includes(CONVENTIONS_MARKER)
}

export function tryUpdateClaudeMd(projectPath: string): void {
  const path = claudeMdPath(projectPath)
  if (!existsSync(path)) return

  const content = readFileSync(path, 'utf-8')
  if (!isSneeblyAuthored(content)) return
  if (hasConventionsRef(content)) return

  // Insert after the first heading line (m flag: ^ matches after any newline)
  const headingMatch = content.match(/^#[^\n]*\n/m)
  if (!headingMatch || headingMatch.index === undefined) return

  const insertAt = headingMatch.index + headingMatch[0].length
  const updated =
    content.slice(0, insertAt) +
    '\n' + CONVENTIONS_REF + '\n' +
    content.slice(insertAt)

  writeFileSync(path, updated, 'utf-8')
}
