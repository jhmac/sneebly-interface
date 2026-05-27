import { webContents } from 'electron'
import { join } from 'node:path'
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises'

// Keep only the N most-recent seed PNGs; older ones are deleted automatically.
const MAX_SEED_FILES = 5

/**
 * Capture the page rendered by the webview whose webContentsId is given,
 * save the PNG to .sneebly-interface/designs/_seeds/, and return a base64
 * data URL for immediate display in the renderer.
 *
 * Returns null if the webContents no longer exists or capture fails.
 *
 * Architecture note: the renderer passes the webview's webContentsId (obtained
 * via webviewElement.getWebContentsId()) over IPC. The main process uses
 * webContents.fromId() to access the webview's own webContents — this is the
 * standard Electron pattern for capturing a webview without requiring a ref
 * to the renderer's DOM.
 */
export async function capturePreview(
  projectPath: string,
  webContentsId: number,
): Promise<{ dataUrl: string } | null> {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) return null

  try {
    const image = await wc.capturePage()
    if (image.isEmpty()) return null

    const pngBuffer = image.toPNG()

    // Persist to disk asynchronously — does not block the IPC response.
    const dir = join(projectPath, '.sneebly-interface', 'designs', '_seeds')
    await mkdir(dir, { recursive: true })
    const filename = `seed-${Date.now()}.png`
    await writeFile(join(dir, filename), pngBuffer)

    // Prune old seeds so they don't accumulate indefinitely.
    pruneOldSeeds(dir).catch(() => { /* best-effort */ })

    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
    return { dataUrl }
  } catch {
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function pruneOldSeeds(dir: string): Promise<void> {
  const entries = await readdir(dir)
  const seeds = entries
    .filter((f) => f.startsWith('seed-') && f.endsWith('.png'))
    .sort()  // lexicographic = chronological because filenames embed timestamps
  const toDelete = seeds.slice(0, Math.max(0, seeds.length - MAX_SEED_FILES))
  await Promise.all(toDelete.map((f) => unlink(join(dir, f))))
}
