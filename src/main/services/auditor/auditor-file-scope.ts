import { readdirSync, statSync, readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import type { AuditableFile } from '../../../shared/types'

// ─── Extension → language map ─────────────────────────────────────────────────

const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rb': 'ruby',
  '.java': 'java',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.sql': 'sql',
  '.prisma': 'sql',
  '.md': 'markdown',
  '.json': 'json',
  '.toml': 'other',
  '.yaml': 'other', '.yml': 'other',
}

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rb', '.java', '.rs', '.swift', '.kt',
])

const SCHEMA_EXTS = new Set(['.prisma', '.sql'])

const CONFIG_PATTERNS = [
  'tsconfig', 'package.json', 'cargo.toml', 'requirements.txt',
  'pyproject.toml', 'gemfile', 'next.config', 'vite.config', 'drizzle.config',
  'tailwind.config', 'eslint', '.eslintrc',
]

const DOC_FILES = new Set(['claude.md', 'goals.md', 'readme.md', 'agents.md', 'contributing.md'])
const ENV_FILES = new Set(['.env.example', '.env.local.example'])

// ─── Exclusion rules ──────────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.github', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.vite', '.cache', 'dist', 'build', 'out', 'coverage',
  '.parcel-cache', '.sneebly-interface', '.vscode', '.idea', '.history',
  '__pycache__', '.pytest_cache', '.mypy_cache', 'target', 'vendor',
])

const EXCLUDED_FILE_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.(generated|gen|codegen)\./,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^bun\.lockb$/,
  /^Cargo\.lock$/,
  /^Pipfile\.lock$/,
  /^Gemfile\.lock$/,
]

const GENERATED_PATH_PATTERNS = [
  /\/generated\//,
  /\/\.generated\//,
  /\/__generated__\//,
]

const GENERATED_FIRST_LINE = [
  '/// auto-generated',
  '// @generated',
  '# auto-generated',
  '/* auto-generated',
  '// auto-generated',
  '<!-- auto-generated',
]

const MAX_FILE_SIZE = 200 * 1024 // 200 KB

// Auth/security/billing high-importance path fragments
const HIGH_IMPORTANCE_PATHS = [
  '/auth/', '/middleware/auth', '/security/', '/billing/', '/payments/', '/stripe/',
  '/admin/', '/webhook/', '/oauth/', '/token/',
]

// High-importance import patterns (checked as substrings in first 50 lines)
const HIGH_IMPORTANCE_IMPORTS = [
  '@clerk/', '@auth/', 'next-auth', 'better-auth', 'stripe', '@stripe/',
  'jsonwebtoken', 'bcrypt', 'argon2', 'passport',
]

// Route handler file patterns
const ROUTE_PATTERNS = [
  /\/pages\/api\//,
  /\/app\/api\//,
  /\/routes\//,
  /\/controllers\//,
  /route\.(ts|js|tsx|jsx)$/,
  /handler\.(ts|js|tsx|jsx)$/,
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
}

function isGeneratedByContent(absolutePath: string): boolean {
  try {
    const fd = readFileSync(absolutePath, 'utf-8')
    const firstLine = fd.split('\n')[0]?.toLowerCase().trim() ?? ''
    return GENERATED_FIRST_LINE.some((marker) => firstLine.startsWith(marker))
  } catch {
    return false
  }
}

function isBinary(absolutePath: string): boolean {
  try {
    const buf = Buffer.alloc(512)
    const fd = openSync(absolutePath, 'r')
    const bytesRead = readSync(fd, buf, 0, 512, 0)
    closeSync(fd)
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true
    }
    return false
  } catch {
    return true
  }
}

function classifyFile(name: string, relPath: string): {
  included: boolean
  category: AuditableFile['category']
  skipReason?: string
} {
  const lower = name.toLowerCase()
  const ext = extname(name).toLowerCase()
  const relLower = relPath.toLowerCase()

  // Env files — only include .env.example variants
  if (lower.startsWith('.env') && !ENV_FILES.has(lower)) {
    return { included: false, category: 'environment', skipReason: 'secrets file' }
  }
  if (ENV_FILES.has(lower)) return { included: true, category: 'environment' }

  // Doc files
  if (DOC_FILES.has(lower)) return { included: true, category: 'documentation' }

  // Schema files
  if (SCHEMA_EXTS.has(ext)) return { included: true, category: 'schema' }

  // Migration directories
  if (relLower.includes('/migrations/') && (ext === '.sql' || ext === '.ts' || ext === '.js')) {
    return { included: true, category: 'schema' }
  }

  // Source files
  if (SOURCE_EXTS.has(ext)) return { included: true, category: 'source' }

  // Config files
  const isConfig = CONFIG_PATTERNS.some((p) => lower.includes(p)) ||
    lower.match(/\.(config|rc)\.(ts|js|json|cjs|mjs|yaml|yml)$/) !== null
  if (isConfig) return { included: true, category: 'config' }

  if (ext === '.json' && lower !== 'package-lock.json') {
    return { included: true, category: 'config' }
  }

  return { included: false, category: 'source', skipReason: 'no matching include rule' }
}

function computeImportance(
  absolutePath: string,
  relPath: string,
  category: AuditableFile['category'],
  sizeBytes: number,
): { importance: AuditableFile['importance']; reason?: string } {
  if (category !== 'source') {
    return { importance: sizeBytes < 2048 ? 'low' : 'medium' }
  }

  const relLower = relPath.toLowerCase()

  // Path-based high importance
  for (const pattern of HIGH_IMPORTANCE_PATHS) {
    if (relLower.includes(pattern)) {
      return { importance: 'high', reason: `path contains ${pattern}` }
    }
  }

  // Route handler
  for (const pattern of ROUTE_PATTERNS) {
    if (pattern.test(relPath)) {
      return { importance: 'high', reason: 'route handler' }
    }
  }

  // Import-based high importance — check first 50 lines
  try {
    const content = readFileSync(absolutePath, 'utf-8')
    const head = content.split('\n').slice(0, 50).join('\n')
    for (const imp of HIGH_IMPORTANCE_IMPORTS) {
      if (head.includes(imp)) {
        return { importance: 'high', reason: `imports ${imp}` }
      }
    }
  } catch { /* skip */ }

  return { importance: 'medium' }
}

// ─── Monorepo detection ───────────────────────────────────────────────────────

export function detectMonorepo(projectPath: string): string[] {
  // Returns list of package paths relative to project root, or [] if not a monorepo
  try {
    const pkgPath = join(projectPath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { workspaces?: string[] | { packages: string[] } }
      if (pkg.workspaces) {
        // Simplified: return the workspaces patterns (real glob expansion would be needed in prod)
        const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages
        return ws ?? []
      }
    }
  } catch { /* skip */ }

  for (const indicator of ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json']) {
    if (existsSync(join(projectPath, indicator))) return ['(monorepo detected)']
  }

  return []
}

// ─── Main walk ────────────────────────────────────────────────────────────────

export interface WalkResult {
  files: AuditableFile[]
  skipped: Array<{ relativePath: string; reason: string }>
}

export function walkProjectFiles(
  projectPath: string,
  extraIgnorePatterns: string[] = [],
): WalkResult {
  const files: AuditableFile[] = []
  const skipped: Array<{ relativePath: string; reason: string }> = []

  const extraIgnoreRegexes = extraIgnorePatterns.map((p) => {
    try { return new RegExp(p) } catch { return null }
  }).filter(Boolean) as RegExp[]

  function walk(dir: string): void {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }

    for (const name of entries) {
      const absPath = join(dir, name)
      const relPath = relative(projectPath, absPath)

      // Skip excluded dirs
      if (EXCLUDED_DIRS.has(name.toLowerCase())) continue

      let stat: ReturnType<typeof statSync>
      try { stat = statSync(absPath) } catch { continue }

      if (stat.isDirectory()) {
        walk(absPath)
        continue
      }

      if (!stat.isFile()) continue

      const sizeBytes = stat.size

      // Extra ignore patterns from audit-rules.json
      if (extraIgnoreRegexes.some((r) => r.test(relPath))) {
        skipped.push({ relativePath: relPath, reason: 'custom ignore rule' })
        continue
      }

      // Too large
      if (sizeBytes > MAX_FILE_SIZE) {
        skipped.push({ relativePath: relPath, reason: `too large (${Math.round(sizeBytes / 1024)}KB > 200KB)` })
        continue
      }

      // Excluded file patterns (lock files, minified, etc.)
      if (EXCLUDED_FILE_PATTERNS.some((p) => p.test(name))) {
        skipped.push({ relativePath: relPath, reason: 'excluded file pattern' })
        continue
      }

      // Generated path patterns — cheap check before content read
      if (GENERATED_PATH_PATTERNS.some((p) => p.test('/' + relPath))) {
        skipped.push({ relativePath: relPath, reason: 'generated path pattern' })
        continue
      }

      // Test files excluded in v1
      if (/\/__tests__\/|\/tests\/|\/test\/|\.test\.|\.spec\./.test(relPath)) {
        skipped.push({ relativePath: relPath, reason: 'test file (v1 scope)' })
        continue
      }

      const { included, category, skipReason } = classifyFile(name, relPath)

      if (!included) {
        skipped.push({ relativePath: relPath, reason: skipReason ?? 'no include rule' })
        continue
      }

      // Binary check
      if (isBinary(absPath)) {
        skipped.push({ relativePath: relPath, reason: 'binary file' })
        continue
      }

      // Generated-by-content check (only for files that passed path checks)
      if (isGeneratedByContent(absPath)) {
        skipped.push({ relativePath: relPath, reason: 'generated file (auto-generated header)' })
        continue
      }

      // Read content for hash
      let content: string
      try { content = readFileSync(absPath, 'utf-8') } catch {
        skipped.push({ relativePath: relPath, reason: 'read error' })
        continue
      }

      const contentHash = sha256(content)
      const ext = extname(name).toLowerCase()
      const language = EXT_LANGUAGE[ext] ?? 'other'
      const { importance, reason: reasonHighPriority } = computeImportance(absPath, relPath, category, sizeBytes)

      files.push({
        absolutePath: absPath,
        relativePath: relPath,
        sizeBytes,
        category,
        language,
        importance,
        reasonHighPriority,
        contentHash,
      })
    }
  }

  walk(projectPath)

  // Sort: high → medium → low (so cancellation yields best findings first)
  files.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.importance] - order[b.importance]
  })

  return { files, skipped }
}

// ─── Excerpt builder ──────────────────────────────────────────────────────────

export function buildExcerpt(
  absolutePath: string,
  startLine: number,
  endLine: number,
  contextLines: number,
): import('../../../shared/types').AuditCodeExcerpt {
  let allLines: string[] = []
  try {
    allLines = readFileSync(absolutePath, 'utf-8').split('\n')
  } catch { /* return empty */ }

  const firstLine = Math.max(1, startLine - contextLines)
  const lastLine = Math.min(allLines.length, endLine + contextLines)
  const lines = allLines.slice(firstLine - 1, lastLine)

  return {
    lines,
    startLine: firstLine,
    highlightStart: startLine,
    highlightEnd: endLine,
    contextLinesBefore: startLine - firstLine,
    contextLinesAfter: lastLine - endLine,
  }
}
