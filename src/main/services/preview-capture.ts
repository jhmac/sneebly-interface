import { webContents } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

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

    // Persist to disk so the seed survives a reload (optional — renderer uses dataUrl)
    const dir = join(projectPath, '.sneebly-interface', 'designs', '_seeds')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `seed-${Date.now()}.png`)
    writeFileSync(filePath, pngBuffer)

    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
    return { dataUrl }
  } catch {
    return null
  }
}
