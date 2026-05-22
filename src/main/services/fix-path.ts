import { execFileSync } from 'node:child_process'

// On macOS, GUI apps launched from Finder/Dock don't inherit the user's shell
// PATH — tools like npm, node, and brew are invisible. We fix this by running
// the login shell and extracting PATH from it once at startup.
export function fixMacOsPath(): void {
  if (process.platform !== 'darwin') return
  try {
    const shell = process.env['SHELL'] ?? '/bin/zsh'
    const output = execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    if (output) process.env['PATH'] = output
  } catch {
    // Best-effort — if the shell launch fails, keep whatever PATH we have
  }
}
