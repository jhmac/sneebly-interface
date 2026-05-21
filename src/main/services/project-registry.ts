import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { Project } from '../../shared/types'

interface Registry {
  projects: Project[]
}

function getProjectsFilePath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

function readRegistry(): Registry {
  const filePath = getProjectsFilePath()
  if (!existsSync(filePath)) return { projects: [] }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Registry
  } catch {
    return { projects: [] }
  }
}

function writeRegistry(registry: Registry): void {
  const filePath = getProjectsFilePath()
  const dir = join(filePath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf-8')
}

export function listProjects(): Project[] {
  return readRegistry().projects
}

export function addProject(project: Project): void {
  const registry = readRegistry()
  const existing = registry.projects.findIndex((p) => p.path === project.path)
  if (existing >= 0) {
    registry.projects[existing] = project
  } else {
    registry.projects.push(project)
  }
  writeRegistry(registry)
}

export function touchProject(id: string): Project | null {
  const registry = readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) return null
  project.lastOpenedAt = Date.now()
  writeRegistry(registry)
  return project
}

export function detectProjectName(projectPath: string): string {
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string }
      if (pkg.name) return pkg.name
    } catch {
      // fall through
    }
  }
  return projectPath.split('/').pop() ?? projectPath
}
