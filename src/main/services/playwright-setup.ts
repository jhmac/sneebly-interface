import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { chromium } from 'playwright'

export function ensureChromiumInstalled(): void {
  let execPath: string
  try {
    execPath = chromium.executablePath()
  } catch {
    execPath = ''
  }

  if (execPath && existsSync(execPath)) return

  console.log('[Sneebly] Chromium not found — installing via playwright...')
  const proc = spawn('npx', ['playwright', 'install', 'chromium'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env },
  })
  proc.on('close', (code) => {
    if (code === 0) {
      console.log('[Sneebly] Chromium installed successfully.')
    } else {
      console.error(`[Sneebly] Chromium install failed (exit code ${code}).`)
    }
  })
  proc.on('error', (err) => {
    console.error('[Sneebly] Failed to spawn playwright install:', err.message)
  })
}
