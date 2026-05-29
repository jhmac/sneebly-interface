import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none'

export function detectPackageManager(projectPath: string): PackageManager {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectPath, 'bun.lockb'))) return 'bun'
  if (existsSync(join(projectPath, 'package-lock.json')) ||
      existsSync(join(projectPath, 'package.json'))) return 'npm'
  return 'none'
}

export interface DepSecInput {
  auditJson: string        // raw output from package manager audit
  packageJson: string      // contents of package.json
  packageManager: PackageManager
}

export function runPackageAudit(projectPath: string): DepSecInput | null {
  const pm = detectPackageManager(projectPath)
  if (pm === 'none') return null

  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return null
  const packageJson = readFileSync(pkgPath, 'utf-8')

  let cmd: string
  switch (pm) {
    case 'pnpm': cmd = 'pnpm audit --json'; break
    case 'yarn': cmd = 'yarn audit --json'; break
    case 'bun':  return null // bun audit not widely available
    default:     cmd = 'npm audit --json'; break
  }

  try {
    // npm audit exits with non-zero when vulnerabilities found — use spawnSync to capture stdout
    const result = spawnSync(cmd.split(' ')[0]!, cmd.split(' ').slice(1), {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60_000,
    })
    const auditJson = result.stdout || ''
    if (!auditJson.trim()) return null
    // Validate it's parseable JSON
    JSON.parse(auditJson)
    return { auditJson, packageJson, packageManager: pm }
  } catch {
    return null
  }
}
