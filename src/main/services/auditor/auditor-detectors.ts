import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditableFile } from '../../../shared/types'

// ─── TODO/FIXME detection ─────────────────────────────────────────────────────

const TODO_PATTERN = /\/\/\s*(TODO|FIXME|XXX|HACK)[:\s](.+)|#\s*(TODO|FIXME|XXX|HACK)[:\s](.+)/gi

export interface TodoItem {
  filePath: string
  line: number
  text: string
  context: string[]
}

export function detectTodos(files: AuditableFile[]): TodoItem[] {
  const results: TodoItem[] = []

  for (const file of files) {
    if (file.category === 'documentation') continue
    let lines: string[]
    try { lines = readFileSync(file.absolutePath, 'utf-8').split('\n') } catch { continue }

    for (let i = 0; i < lines.length; i++) {
      const match = TODO_PATTERN.exec(lines[i]!)
      TODO_PATTERN.lastIndex = 0 // reset global regex
      if (!match) continue
      const text = (match[2] ?? match[4] ?? '').trim()
      const contextStart = Math.max(0, i - 2)
      const contextEnd = Math.min(lines.length - 1, i + 2)
      results.push({
        filePath: file.relativePath,
        line: i + 1,
        text: `${match[1] ?? match[3]}: ${text}`,
        context: lines.slice(contextStart, contextEnd + 1),
      })
    }
  }

  return results
}

// ─── process.env reference detection ─────────────────────────────────────────

export interface EnvRef {
  name: string
  filePath: string
  line: number
}

const ENV_PATTERN = /process\.env\[['"`]([A-Z0-9_]+)['"`]\]|process\.env\.([A-Z0-9_]+)/g

export function detectEnvRefs(files: AuditableFile[]): EnvRef[] {
  const results: EnvRef[] = []
  const sourceFiles = files.filter((f) => f.category === 'source')

  for (const file of sourceFiles) {
    let lines: string[]
    try { lines = readFileSync(file.absolutePath, 'utf-8').split('\n') } catch { continue }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      let match: RegExpExecArray | null
      ENV_PATTERN.lastIndex = 0
      while ((match = ENV_PATTERN.exec(line)) !== null) {
        const name = match[1] ?? match[2]
        if (name && name !== 'NODE_ENV' && name !== 'PORT') {
          results.push({ name, filePath: file.relativePath, line: i + 1 })
        }
      }
    }
  }

  return results
}

// ─── .env.example reader ──────────────────────────────────────────────────────

export function readEnvExample(projectPath: string): string[] {
  for (const name of ['.env.example', '.env.local.example']) {
    const p = join(projectPath, name)
    if (!existsSync(p)) continue
    try {
      return readFileSync(p, 'utf-8')
        .split('\n')
        .map((l) => l.split('=')[0]?.replace(/^#\s*/, '').trim())
        .filter(Boolean) as string[]
    } catch { /* skip */ }
  }
  return []
}
