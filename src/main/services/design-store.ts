import { join } from 'node:path'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
  renameSync,
} from 'node:fs'
import type { DesignFile, DesignSummary } from '../../shared/types'

const DESIGNS_DIR = join('.sneebly-interface', 'designs')

function designsDir(projectPath: string): string {
  return join(projectPath, DESIGNS_DIR)
}

function designFilePath(projectPath: string, name: string): string {
  return join(designsDir(projectPath), `${name}.json`)
}

function ensureDir(projectPath: string): void {
  mkdirSync(designsDir(projectPath), { recursive: true })
}

export function listDesigns(projectPath: string): DesignSummary[] {
  const dir = designsDir(projectPath)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const name = f.slice(0, -5) // strip .json
        try {
          const data = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as DesignFile
          return { name, updatedAt: data.updatedAt ?? 0 }
        } catch {
          return { name, updatedAt: 0 }
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function loadDesign(projectPath: string, name: string): DesignFile | null {
  const p = designFilePath(projectPath, name)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as DesignFile
  } catch {
    return null
  }
}

export function saveDesign(projectPath: string, design: DesignFile): void {
  ensureDir(projectPath)
  const updated: DesignFile = { ...design, updatedAt: Date.now() }
  writeFileSync(designFilePath(projectPath, design.name), JSON.stringify(updated, null, 2), 'utf-8')
}

export function deleteDesign(projectPath: string, name: string): void {
  const p = designFilePath(projectPath, name)
  if (existsSync(p)) unlinkSync(p)
}

export function renameDesign(projectPath: string, oldName: string, newName: string): void {
  const oldPath = designFilePath(projectPath, oldName)
  const newPath = designFilePath(projectPath, newName)
  if (existsSync(oldPath)) renameSync(oldPath, newPath)
}
