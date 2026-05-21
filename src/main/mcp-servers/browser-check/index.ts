import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { runBrowserCheck, type BrowserCheckInput } from './browser'

const server = new Server(
  { name: 'sneebly-browser-check', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

const BROWSER_CHECK_TOOL = {
  name: 'browser_check',
  description:
    'Load a URL in headless Chromium and return rendered DOM state, console messages, network requests, CSP violations, and a screenshot. Use this when you need to verify a webpage actually renders correctly, debug why content is not showing, or inspect browser-side errors. Do NOT install Playwright in user projects — this tool replaces that workflow.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'URL to load, e.g. http://localhost:3100/',
      },
      viewport: {
        type: 'object',
        properties: {
          width: { type: 'number' },
          height: { type: 'number' },
        },
        description: 'Optional viewport size. Defaults to 1440x900.',
      },
      waitFor: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle'],
        description: 'When to consider the page loaded. Defaults to networkidle.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in ms. Defaults to 30000.',
      },
    },
    required: ['url'],
  },
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [BROWSER_CHECK_TOOL],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'browser_check') {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    }
  }

  const input = request.params.arguments as unknown as BrowserCheckInput

  try {
    const result = await runBrowserCheck(input)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `browser_check failed: ${message}` }],
      isError: true,
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`)
  process.exit(1)
})
