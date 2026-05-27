import { useEffect, useRef, useState } from 'react'
import type { ArtifactKind } from '../../../shared/types'

export type { ArtifactKind }

interface Props {
  kind: ArtifactKind
  code: string
}

const IFRAME_MIN_HEIGHT = 120
const IFRAME_MAX_HEIGHT = 600

// ─── Source doc builders ────────────────────────────────────────────────────

// Strip ESM import statements (handles multi-line imports) and export keywords
function processReactCode(code: string): string {
  // Collapse multi-line imports onto one line so the single-pass regex works
  let s = code.replace(/import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '')
  // Strip bare `import 'foo'` side-effect imports
  s = s.replace(/import\s+['"][^'"]+['"]\s*;?/g, '')
  // Strip `export default` and `export { ... }`
  s = s.replace(/^\s*export\s+default\s+/gm, '')
  s = s.replace(/^\s*export\s+\{[^}]*\}\s*;?/gm, '')
  return s.trim()
}

// Extract the PascalCase component name from `function Foo` or `const Foo =`
function findComponentName(code: string): string {
  const fnMatch = /function\s+([A-Z][a-zA-Z0-9_]*)/.exec(code)
  if (fnMatch) return fnMatch[1]!
  const constMatch = /const\s+([A-Z][a-zA-Z0-9_]*)\s*=/.exec(code)
  if (constMatch) return constMatch[1]!
  return 'App'
}

function reportHeightScript(id: string): string {
  return `
<script>
(function () {
  var id = '${id}';
  function report() {
    parent.postMessage({ type: 'sneebly-iframe-height', id: id, height: document.documentElement.scrollHeight }, '*');
  }
  if (window.ResizeObserver) {
    new ResizeObserver(report).observe(document.body);
  }
  report();
})();
</script>`
}

function buildHtmlSrcDoc(code: string, id: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; }</style>
</head>
<body>
${code}
${reportHeightScript(id)}
</body>
</html>`
}

function buildReactSrcDoc(code: string, id: string): string {
  const cleaned = processReactCode(code)
  const componentName = findComponentName(cleaned)
  // Babel renders async — poll height a few times after load to catch late layouts
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; }</style>
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
${cleaned}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(${componentName}));
</script>
<script>
(function () {
  var id = '${id}';
  function report() {
    parent.postMessage({ type: 'sneebly-iframe-height', id: id, height: document.documentElement.scrollHeight }, '*');
  }
  // Babel is async — poll for ~2 s after load to catch post-render height
  var attempts = 0;
  var iv = setInterval(function () {
    report();
    if (++attempts >= 10) clearInterval(iv);
  }, 200);
})();
</script>
</body>
</html>`
}

function buildSvgSrcDoc(code: string, id: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>* { box-sizing: border-box; } body { margin: 0; display: flex; justify-content: center; }</style>
</head>
<body>
${code}
${reportHeightScript(id)}
</body>
</html>`
}

function buildMermaidSrcDoc(code: string, id: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 8px; }
  .mermaid { display: flex; justify-content: center; }
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head>
<body>
<div class="mermaid">
${code}
</div>
<script>
(function () {
  var id = '${id}';
  function report() {
    parent.postMessage({ type: 'sneebly-iframe-height', id: id, height: document.documentElement.scrollHeight }, '*');
  }
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
  // Mermaid renders async — report after a short delay and again after longer
  setTimeout(report, 300);
  setTimeout(report, 800);
})();
</script>
</body>
</html>`
}

function buildSrcDoc(kind: ArtifactKind, code: string, id: string): string {
  switch (kind) {
    case 'html':    return buildHtmlSrcDoc(code, id)
    case 'react':   return buildReactSrcDoc(code, id)
    case 'svg':     return buildSvgSrcDoc(code, id)
    case 'mermaid': return buildMermaidSrcDoc(code, id)
  }
}

// ─── SandboxedArtifact ───────────────────────────────────────────────────────

export default function SandboxedArtifact({ kind, code }: Props) {
  // Stable per-instance ID so multiple iframes don't cross-talk on postMessage
  const instanceId = useRef(`sba-${Math.random().toString(36).slice(2)}`)
  const [height, setHeight] = useState(IFRAME_MIN_HEIGHT)

  // srcDoc is stable as long as kind + code don't change
  const srcDoc = buildSrcDoc(kind, code, instanceId.current)

  useEffect(() => {
    const id = instanceId.current
    function onMessage(e: MessageEvent) {
      if (
        e.data?.type === 'sneebly-iframe-height' &&
        e.data.id === id &&
        typeof e.data.height === 'number'
      ) {
        setHeight(Math.min(Math.max(e.data.height, IFRAME_MIN_HEIGHT), IFRAME_MAX_HEIGHT))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      style={{ height }}
      className="w-full rounded-b-xl bg-white"
      title={`${kind} artifact`}
    />
  )
}
