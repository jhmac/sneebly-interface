import { listProjects } from '../services/project-registry'

/**
 * Resolve a projectId to its on-disk path.
 * Throws a descriptive error if the project is not in the registry —
 * this acts as a working-directory boundary check for all design IPC handlers.
 */
export function getProjectPath(projectId: string): string {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project.path
}
