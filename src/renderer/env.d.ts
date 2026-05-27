/// <reference types="vite/client" />
import type { ElectronAPI } from '../shared/types'

declare global {
  interface Window {
    api: ElectronAPI
  }

  // Minimal typing for Electron's <webview> tag in React JSX
  interface ElectronWebviewElement extends HTMLElement {
    src: string
    goBack(): void
    goForward(): void
    reload(): void
    stop(): void
    loadURL(url: string): void
    getURL(): string
    canGoBack(): boolean
    canGoForward(): boolean
    openDevTools(): void
    setZoomFactor(factor: number): void
    /** Returns the webContents ID of this webview's guest content. */
    getWebContentsId(): number
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: {
        ref?: React.Ref<HTMLElement>
        src?: string
        allowpopups?: boolean
        partition?: string
        webpreferences?: string
        style?: React.CSSProperties
        className?: string
        key?: React.Key
      }
    }
  }
}
