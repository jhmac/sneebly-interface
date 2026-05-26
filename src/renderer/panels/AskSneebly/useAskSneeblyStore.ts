import { create } from 'zustand'
import type { AskSneeblyConversation, AskSneeblyMessage } from '../../../shared/types'

interface AskSneeblyStore {
  currentConversation: AskSneeblyConversation | null
  isStreaming: boolean
  currentTurnId: string | null
  sidebarVisible: boolean

  setSidebarVisible: (v: boolean) => void
  toggleSidebar: () => void
  newConversation: (projectId: string) => void
  askQuestion: (
    projectId: string,
    question: string,
    opts: { includeDiff: boolean; includeEvents: boolean }
  ) => Promise<void>
  cancelCurrent: () => void

  // Wired to IPC push events from App.tsx
  _onChunk: (turnId: string, chunk: string) => void
  _onThinking: (turnId: string, status: string) => void
  _onDone: (turnId: string, error?: string) => void
}

function updateStreamingMessage(
  conv: AskSneeblyConversation | null,
  turnId: string,
  currentTurnId: string | null,
  updater: (m: AskSneeblyMessage) => AskSneeblyMessage
): AskSneeblyConversation | null {
  if (!conv || turnId !== currentTurnId) return conv
  return {
    ...conv,
    messages: conv.messages.map((m) => (m.isStreaming ? updater(m) : m)),
  }
}

export const useAskSneeblyStore = create<AskSneeblyStore>((set, get) => ({
  currentConversation: null,
  isStreaming: false,
  currentTurnId: null,
  sidebarVisible: false,

  setSidebarVisible: (v) => {
    set({ sidebarVisible: v })
    window.api.settingsSet({ askSneeblySidebarVisible: v }).catch(() => {})
  },

  toggleSidebar: () => get().setSidebarVisible(!get().sidebarVisible),

  newConversation: (projectId) => {
    // Cancel any in-flight turn so starting fresh doesn't orphan a running subprocess.
    const inFlight = get().currentTurnId
    if (inFlight) window.api.askSneeblyCancel(inFlight).catch(() => {})
    set({
      currentConversation: {
        id: crypto.randomUUID(),
        projectId,
        startedAt: Date.now(),
        messages: [],
      },
      isStreaming: false,
      currentTurnId: null,
    })
  },

  askQuestion: async (projectId, question, opts) => {
    if (get().isStreaming) return
    let conv = get().currentConversation
    if (!conv || conv.projectId !== projectId) {
      get().newConversation(projectId)
      conv = get().currentConversation!
    }

    const userMsg: AskSneeblyMessage = {
      id: crypto.randomUUID(),
      conversationId: conv.id,
      role: 'user',
      content: question,
      createdAt: Date.now(),
    }
    const assistantMsg: AskSneeblyMessage = {
      id: crypto.randomUUID(),
      conversationId: conv.id,
      role: 'assistant',
      content: '',
      thinking: [],
      createdAt: Date.now(),
      isStreaming: true,
    }
    set({
      currentConversation: { ...conv, messages: [...conv.messages, userMsg, assistantMsg] },
      isStreaming: true,
    })

    try {
      const { turnId } = await window.api.askSneeblyStart({
        projectId,
        question,
        conversationId: conv.id,
        includeDiff: opts.includeDiff,
        includeEvents: opts.includeEvents,
      })
      set({ currentTurnId: turnId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((s) => ({
        isStreaming: false,
        currentTurnId: null,
        currentConversation: s.currentConversation && {
          ...s.currentConversation,
          messages: s.currentConversation.messages.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false, error: message } : m
          ),
        },
      }))
    }
  },

  cancelCurrent: () => {
    const turnId = get().currentTurnId
    if (turnId) window.api.askSneeblyCancel(turnId).catch(() => {})
  },

  _onThinking: (turnId, status) => {
    set((s) => ({
      currentConversation: updateStreamingMessage(
        s.currentConversation, turnId, s.currentTurnId,
        (m) => ({ ...m, thinking: [...(m.thinking ?? []), status] })
      ),
    }))
  },

  _onChunk: (turnId, chunk) => {
    set((s) => ({
      currentConversation: updateStreamingMessage(
        s.currentConversation, turnId, s.currentTurnId,
        // First real content clears the thinking lines.
        (m) => ({ ...m, content: m.content + chunk, thinking: [] })
      ),
    }))
  },

  _onDone: (turnId, error) => {
    if (turnId !== get().currentTurnId) return
    const cancelled = error === 'cancelled'
    set((s) => ({
      isStreaming: false,
      currentTurnId: null,
      currentConversation: s.currentConversation && {
        ...s.currentConversation,
        messages: s.currentConversation.messages.map((m) => {
          if (!m.isStreaming) return m
          if (cancelled) {
            return { ...m, isStreaming: false, content: m.content + '\n\n_[cancelled]_' }
          }
          return { ...m, isStreaming: false, error: error || undefined }
        }),
      },
    }))
  },
}))
