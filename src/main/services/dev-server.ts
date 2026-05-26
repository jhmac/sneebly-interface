import { spawn, execSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { PreviewStatusEvent } from '../../shared/types'
import { getAllSecrets } from './secrets-store'

const URL_REGEX = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/
const RING_SIZE = 200

type StatusCallback = (event: PreviewStatusEvent) => void

interface ServerEntry {
  proc: ChildProcess
  logs: string[]
  stderrLines: string[]
  url: string | null
  generation: number
  stopping: boolean
  killTimer?: ReturnType<typeof setTimeout>
}

const active = new Map<string, ServerEntry>()
let onStatus: StatusCallback | null = null
let nextGen = 0

export function setStatusCallback(cb: StatusCallback): void {
  onStatus = cb
}

function emit(event: PreviewStatusEvent): void {
  onStatus?.(event)
}

function pushLog(entry: ServerEntry, line: string): void {
  entry.logs.push(line)
  if (entry.logs.length > RING_SIZE) entry.logs.shift()
}

export function detectDevCommand(projectPath: string): string | null {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: { dev?: string; start?: string }
    }
    if (pkg.scripts?.dev) return 'npm run dev'
    if (pkg.scripts?.start) return 'npm run start'
  } catch {
    // ignore
  }
  return null
}

export async function startServer(projectId: string, projectPath: string): Promise<void> {
  // Kill any existing server for this project — must kill the whole process group
  // (shell + npm + tsx + node) not just the shell wrapper, otherwise children
  // keep holding the port and the new process immediately hits EADDRINUSE.
  const old = active.get(projectId)
  if (old) {
    clearTimeout(old.killTimer)
    killGroup(old.proc, 'SIGTERM')
    old.killTimer = setTimeout(() => killGroup(old.proc, 'SIGKILL'), 3000)
  }

  const command = detectDevCommand(projectPath)
  if (!command) {
    emit({ projectId, type: 'no-script' })
    return
  }

  const generation = ++nextGen
  emit({ projectId, type: 'starting' })

  const secrets = await getAllSecrets(projectId).catch(() => ({} as Record<string, string>))

  const proc = spawn(command, {
    shell: true,
    cwd: projectPath,
    env: { ...process.env, ...secrets },
    stdio: 'pipe',
    detached: true,  // gives the shell its own process group so we can kill the whole tree
  })

  const entry: ServerEntry = {
    proc,
    logs: [],
    stderrLines: [],
    url: null,
    generation,
    stopping: false,
  }

  // Replaces old entry — old proc's exit handler will see a generation mismatch
  // and return early without emitting
  active.set(projectId, entry)

  function handleLine(line: string, isStderr: boolean): void {
    pushLog(entry, line)
    if (isStderr) {
      entry.stderrLines.push(line)
      if (entry.stderrLines.length > 200) entry.stderrLines.shift()

      // Auto-clear port and retry on EADDRINUSE (matches both Node's native message
      // and our custom "Port N is already in use" message from server/index.ts)
      if (!entry.stopping && (line.includes('EADDRINUSE') || line.includes('already in use'))) {
        const portMatch = line.match(/[: ](\d{4,5})/)
        if (portMatch) {
          const stuckPort = portMatch[1]
          try {
            execSync(`lsof -ti :${stuckPort} | xargs kill -9`, { stdio: 'ignore' })
          } catch {}
          setTimeout(() => startServer(projectId, projectPath), 1500)
        }
      }
    }
    // Check both stdout and stderr for the URL
    if (!entry.url) {
      const m = line.match(URL_REGEX)
      if (m) {
        entry.url = m[0]
          .replace('127.0.0.1', 'localhost')
          .replace('0.0.0.0', 'localhost')
        emit({ projectId, type: 'running', url: entry.url })
      }
    }
  }

  let outBuf = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    outBuf += chunk.toString()
    const lines = outBuf.split('\n')
    outBuf = lines.pop() ?? ''
    for (const l of lines) handleLine(l, false)
  })

  let errBuf = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    errBuf += chunk.toString()
    const lines = errBuf.split('\n')
    errBuf = lines.pop() ?? ''
    for (const l of lines) handleLine(l, true)
  })

  proc.on('exit', (code, signal) => {
    const current = active.get(projectId)
    // Stale exit from a replaced process — ignore
    if (!current || current.generation !== generation) return

    active.delete(projectId)
    clearTimeout(current.killTimer)

    if (current.stopping || signal === 'SIGTERM' || signal === 'SIGKILL') {
      emit({ projectId, type: 'stopped' })
    } else if (code !== 0 && code !== null) {
      emit({
        projectId,
        type: 'crashed',
        stderrTail: current.stderrLines.slice(-50),
      })
      // Auto-restart after unexpected crash (2 s delay to avoid tight loops)
      setTimeout(() => startServer(projectId, projectPath), 2000)
    } else {
      emit({ projectId, type: 'stopped' })
    }
  })
}

function killGroup(proc: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (proc.pid == null) return
  try { process.kill(-proc.pid, signal) } catch {
    // Process group may already be gone — fall back to direct kill
    try { proc.kill(signal) } catch {}
  }
}

export function stopServer(projectId: string): void {
  const entry = active.get(projectId)
  if (!entry) return
  entry.stopping = true
  clearTimeout(entry.killTimer)
  killGroup(entry.proc, 'SIGTERM')
  entry.killTimer = setTimeout(() => killGroup(entry.proc, 'SIGKILL'), 3000)
}

export function stopAllServers(): void {
  for (const [, entry] of active) {
    clearTimeout(entry.killTimer)
    killGroup(entry.proc, 'SIGTERM')
    setTimeout(() => killGroup(entry.proc, 'SIGKILL'), 3000)
  }
  active.clear()
}

export function getLogs(projectId: string): string[] {
  return [...(active.get(projectId)?.logs ?? [])]
}

export function getServerUrl(projectId: string): string | null {
  return active.get(projectId)?.url ?? null
}
