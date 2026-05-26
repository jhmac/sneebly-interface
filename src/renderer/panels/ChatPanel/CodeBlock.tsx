import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'

// Module-level singleton — one highlighter loaded once for the whole app
let hl: Promise<import('shiki').Highlighter> | null = null

function getHighlighter(): Promise<import('shiki').Highlighter> {
  if (!hl) {
    hl = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['vitesse-dark'],
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx',
          'python', 'bash', 'sh', 'json', 'yaml', 'toml',
          'css', 'html', 'markdown', 'sql', 'go', 'rust',
          'diff', 'text',
        ],
      })
    )
  }
  return hl
}

// Eagerly kick off the load so it's ready before the first message
if (typeof window !== 'undefined') getHighlighter()

export default function CodeBlock({ language, code }: { language: string; code: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Debounce highlighting: while a message streams in, `code` grows every token.
  // Highlighting per token thrashes the CPU, so wait until the code settles and
  // show the plain <pre> fallback in the meantime.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      getHighlighter()
        .then((h) => {
          if (cancelled) return
          try {
            const lang = h.getLoadedLanguages().includes(language as never) ? language : 'text'
            setHtml(h.codeToHtml(code, { lang, theme: 'vitesse-dark' }))
          } catch {
            setHtml(null)
          }
        })
        .catch(() => {})
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [code, language])

  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-lg text-sm">
      {html ? (
        <div
          dangerouslySetInnerHTML={{ __html: html }}
          className="overflow-x-auto [&>pre]:p-4"
        />
      ) : (
        <pre className="overflow-x-auto bg-zinc-900 p-4 font-mono text-xs text-zinc-300">
          <code>{code}</code>
        </pre>
      )}
      <button
        onClick={copy}
        className="absolute right-2 top-2 hidden items-center gap-1 rounded bg-zinc-700/80 px-2 py-1 text-xs text-zinc-300 group-hover:flex hover:bg-zinc-600/80"
      >
        {copied ? (
          <><Check className="h-3 w-3" /> Copied</>
        ) : (
          <><Copy className="h-3 w-3" /> Copy</>
        )}
      </button>
    </div>
  )
}
