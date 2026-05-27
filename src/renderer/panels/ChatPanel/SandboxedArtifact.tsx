import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactKind } from '../../../shared/types'

interface Props {
  kind: ArtifactKind
  code: string
}

const IFRAME_MIN_HEIGHT = 120
const IFRAME_MAX_HEIGHT = 600

// ─── React code processing ───────────────────────────────────────────────────

// Strip ESM imports (including multi-line) and export keywords so the code
// runs in the Babel CDN context where React/ReactDOM are global.
function processReactCode(code: string): string {
  let s = code
    // Multi-line named imports: import { A, B } from '...'
    .replace(/import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '')
    // Side-effect imports: import 'foo'
    .replace(/import\s+['"][^'"]+['"]\s*;?/g, '')
  // Strip export modifiers that aren't valid at top-level in this context
  s = s
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?/gm, '')
  return s.trim()
}

// Finds the first PascalCase identifier from `function Foo` or `const Foo =`
function findComponentName(code: string): string {
  const fnMatch = /function\s+([A-Z][a-zA-Z0-9_]*)/.exec(code)
  if (fnMatch) return fnMatch[1]!
  const constMatch = /const\s+([A-Z][a-zA-Z0-9_]*)\s*=/.exec(code)
  if (constMatch) return constMatch[1]!
  return 'App'
}

// ─── Shared height reporter ──────────────────────────────────────────────────

// Plain <script> (not type="text/babel") — runs immediately on parse so the
// ResizeObserver is in place before any async renderer (Babel, Mermaid) fires.
function resizeScript(id: string): string {
  return `<script>
(function () {
  var id = '${id}';
  function report() {
    parent.postMessage({ type: 'sneebly-iframe-height', id: id, height: document.documentElement.scrollHeight }, '*');
  }
  if (window.ResizeObserver) {
    new ResizeObserver(report).observe(document.body);
  }
})();
</script>`
}

// ─── Source doc builders ─────────────────────────────────────────────────────

function buildHtmlSrcDoc(code: string, id: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>* { box-sizing: border-box; } body { margin: 0; background: #fff; font-family: system-ui, sans-serif; }</style>
</head>
<body>
${code}
${resizeScript(id)}
</body>
</html>`
}

function buildReactSrcDoc(code: string, id: string): string {
  const cleaned = processReactCode(code)
  const componentName = findComponentName(cleaned)
  // Height strategy:
  //   1. queueMicrotask inside the babel block fires right after React's sync
  //      scheduling step — catches the initial render.
  //   2. A 300 ms follow-up catches async content (images, deferred effects).
  //   3. The resizeScript ResizeObserver catches any subsequent layout changes.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>* { box-sizing: border-box; } body { margin: 0; background: #fff; font-family: system-ui, sans-serif; }</style>
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
${cleaned}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(${componentName}));
queueMicrotask(function () {
  parent.postMessage({ type: 'sneebly-iframe-height', id: '${id}', height: document.documentElement.scrollHeight }, '*');
  setTimeout(function () {
    parent.postMessage({ type: 'sneebly-iframe-height', id: '${id}', height: document.documentElement.scrollHeight }, '*');
  }, 300);
});
</script>
${resizeScript(id)}
</body>
</html>`
}

function buildSvgSrcDoc(code: string, id: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>* { box-sizing: border-box; } body { margin: 0; background: #fff; display: flex; justify-content: center; }</style>
</head>
<body>
${code}
${resizeScript(id)}
</body>
</html>`
}

function buildMermaidSrcDoc(code: string, id: string): string {
  // Use startOnLoad: false + explicit mermaid.run() so rendering is
  // predictable regardless of when the script tag executes.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 8px; background: #09090b; }
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
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  mermaid.run({ nodes: document.querySelectorAll('.mermaid') }).then(function () {
    report();
    if (window.ResizeObserver) {
      new ResizeObserver(report).observe(document.body);
    }
  });
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
  // Stable per-instance ID prevents postMessage cross-talk when multiple
  // artifacts are rendered in the same chat window.
  const instanceId = useRef(`sba-${Math.random().toString(36).slice(2)}`)
  const [height, setHeight] = useState(IFRAME_MIN_HEIGHT)

  // Memoize so large template strings don't rebuild on every parent re-render.
  const srcDoc = useMemo(
    () => buildSrcDoc(kind, code, instanceId.current),
    [kind, code]
  )

  useEffect(() => {
    const id = instanceId.current
    function onMessage(e: MessageEvent) {
      if (
        e.data?.type === 'sneebly-iframe-height' &&
        e.data.id === id &&
        typeof e.data.height === 'number'
      ) {
        setHeight(Math.min(Math.max(e.data.height as number, IFRAME_MIN_HEIGHT), IFRAME_MAX_HEIGHT))
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
      // bg-transparent: let each srcDoc's body background govern;
      // avoids a white flash for dark-themed artifacts (Mermaid).
      className="w-full bg-transparent"
      title={`${kind} artifact`}
    />
  )
}
