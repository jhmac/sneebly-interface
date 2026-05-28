import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, existsSync } from 'fs'

let cachedConfigPath: string | null = null

export function getMcpConfigPath(): string {
  if (cachedConfigPath) return cachedConfigPath
  cachedConfigPath = join(app.getPath('userData'), 'sneebly-mcp.json')
  return cachedConfigPath
}

export function generateMcpConfig(): void {
  // __dirname in the built main process = out/main/
  // MCP server is compiled alongside main at out/main/mcp-servers/browser-check/index.js
  const mcpServerPath = join(__dirname, 'mcp-servers', 'browser-check', 'index.js')

  // Only register the server if the binary actually exists at the computed path.
  // If it doesn't (stale config from a packaged build, unbuilt dev tree, etc.),
  // write an empty server list so claude does not fail on startup trying to spawn
  // a missing process. Without this, claude exits code 1 with no JSON output —
  // making the failure appear as the opaque "Process exited with code 1" error.
  const serverExists = existsSync(mcpServerPath)

  const config = {
    mcpServers: serverExists
      ? {
          'sneebly-browser-check': {
            command: 'node',
            args: [mcpServerPath],
            env: {},
          },
        }
      : {},
  }

  const configPath = getMcpConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  if (serverExists) {
    console.log(`[Sneebly] MCP config written to ${configPath}`)
  } else {
    console.warn(`[Sneebly] browser-check MCP server not found at ${mcpServerPath} — writing empty MCP config`)
  }
}
