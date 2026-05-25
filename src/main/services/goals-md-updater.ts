import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

function goalsPath(projectPath: string): string {
  return join(projectPath, 'GOALS.md')
}

function startTag(id: string): string {
  return `<!-- sneebly:open-q:${id}:start -->`
}

function endTag(id: string): string {
  return `<!-- sneebly:open-q:${id}:end -->`
}

export function appendOpenQuestion(
  projectPath: string,
  id: string,
  question: string
): boolean {
  const path = goalsPath(projectPath)
  if (!existsSync(path)) return false

  const content = readFileSync(path, 'utf-8')

  // Don't duplicate
  if (content.includes(startTag(id))) return false

  const block = `${startTag(id)}\n- ${question.trim()}\n${endTag(id)}`

  const sectionMatch = content.match(/^## Open Questions\s*$/m)
  if (sectionMatch && sectionMatch.index !== undefined) {
    // Find the end of the section header line and insert after
    const insertAt = sectionMatch.index + sectionMatch[0].length
    const updated = content.slice(0, insertAt) + '\n\n' + block + content.slice(insertAt)
    writeFileSync(path, updated, 'utf-8')
  } else {
    // No Open Questions section — append one
    const updated = content.trimEnd() + '\n\n## Open Questions\n\n' + block + '\n'
    writeFileSync(path, updated, 'utf-8')
  }

  return true
}

export function revertOpenQuestion(projectPath: string, id: string): void {
  const path = goalsPath(projectPath)
  if (!existsSync(path)) return

  const content = readFileSync(path, 'utf-8')
  const start = startTag(id)
  const end = endTag(id)

  const startIdx = content.indexOf(start)
  const endIdx = content.indexOf(end)
  if (startIdx === -1 || endIdx === -1) return

  // Remove the block including surrounding newlines
  const before = content.slice(0, startIdx).replace(/\n+$/, '')
  const after = content.slice(endIdx + end.length).replace(/^\n+/, '\n')
  writeFileSync(path, before + after, 'utf-8')
}
