import { app } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

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

  const config = {
    mcpServers: {
      'sneebly-browser-check': {
        command: 'node',
        args: [mcpServerPath],
        env: {},
      },
    },
  }

  const configPath = getMcpConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  console.log(`[Sneebly] MCP config written to ${configPath}`)
}
