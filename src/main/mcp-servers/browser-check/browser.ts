import { chromium } from 'playwright'
import { existsSync } from 'fs'

export interface ConsoleMessage {
  level: string
  text: string
  url?: string
  line?: number
}

export interface NetworkRequest {
  url: string
  status?: number
  contentType?: string
  ok: boolean
}

export interface FailedRequest {
  url: string
  errorText: string
}

export interface CspViolation {
  violatedDirective: string
  blockedURI: string
}

export interface BrowserCheckResult {
  url: string
  finalUrl: string
  status: number
  title: string
  rootChildren: number
  bodyBackground: string
  domSnippet: string
  consoleMessages: ConsoleMessage[]
  networkRequests: NetworkRequest[]
  failedRequests: FailedRequest[]
  cspViolations: CspViolation[]
  screenshotPath: string
  durationMs: number
}

export interface BrowserCheckInput {
  url: string
  viewport?: { width: number; height: number }
  waitFor?: 'load' | 'domcontentloaded' | 'networkidle'
  timeoutMs?: number
}

export async function runBrowserCheck(input: BrowserCheckInput): Promise<BrowserCheckResult> {
  const { url, viewport, waitFor = 'networkidle', timeoutMs = 30000 } = input
  const start = Date.now()

  const execPath = chromium.executablePath()
  if (!existsSync(execPath)) {
    throw new Error(`Chromium not found at ${execPath}. Run: npx playwright install chromium`)
  }

  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({
      viewport: viewport ?? { width: 1440, height: 900 },
    })

    const consoleMessages: ConsoleMessage[] = []
    const networkRequests: NetworkRequest[] = []
    const failedRequests: FailedRequest[] = []
    const cspViolations: CspViolation[] = []
    const statusMap = new Map<string, number>()
    const contentTypeMap = new Map<string, string>()

    const page = await context.newPage()

    // Inject CSP violation listener before any page code runs
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.error(
          `[CSP] ${e.violatedDirective} blocked ${e.blockedURI}`
        )
      })
    })

    page.on('console', (msg) => {
      const text = msg.text()
      // Parse CSP violations from console errors
      const cspMatch = /\[CSP\] (\S+) blocked (\S*)/.exec(text)
      if (cspMatch) {
        cspViolations.push({ violatedDirective: cspMatch[1], blockedURI: cspMatch[2] })
        return
      }
      consoleMessages.push({
        level: msg.type(),
        text,
        url: msg.location().url || undefined,
        line: msg.location().lineNumber || undefined,
      })
    })

    page.on('response', (response) => {
      statusMap.set(response.url(), response.status())
      const ct = response.headers()['content-type']
      if (ct) contentTypeMap.set(response.url(), ct.split(';')[0].trim())
    })

    page.on('requestfailed', (request) => {
      failedRequests.push({
        url: request.url(),
        errorText: request.failure()?.errorText ?? 'unknown error',
      })
    })

    page.on('requestfinished', (request) => {
      const reqUrl = request.url()
      const status = statusMap.get(reqUrl)
      const contentType = contentTypeMap.get(reqUrl)
      networkRequests.push({
        url: reqUrl,
        status,
        contentType,
        ok: status !== undefined ? status >= 200 && status < 400 : true,
      })
    })

    const response = await page.goto(url, {
      waitUntil: waitFor,
      timeout: timeoutMs,
    })

    const finalUrl = page.url()
    const status = response?.status() ?? 0
    const title = await page.title()

    const [rootChildren, bodyBackground, domSnippet] = await page.evaluate(() => {
      const root = document.querySelector('#root')
      const rootCount = root ? root.children.length : 0
      const bg = window.getComputedStyle(document.body).backgroundColor
      const bodyHtml = document.body?.innerHTML ?? document.documentElement.outerHTML
      return [rootCount, bg, bodyHtml.slice(0, 5000)] as [number, string, string]
    })

    const screenshotPath = `/tmp/sneebly-browser-check-${Date.now()}.png`
    await page.screenshot({ path: screenshotPath, fullPage: false })

    await browser.close()

    return {
      url,
      finalUrl,
      status,
      title,
      rootChildren,
      bodyBackground,
      domSnippet,
      consoleMessages,
      // Deduplicate network requests by URL, keep first occurrence
      networkRequests: Array.from(
        new Map(networkRequests.map((r) => [r.url, r])).values()
      ).slice(0, 50),
      failedRequests,
      cspViolations,
      screenshotPath,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    await browser.close().catch(() => {})
    throw err
  }
}
