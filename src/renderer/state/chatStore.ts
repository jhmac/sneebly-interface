import { create } from 'zustand'
import type { ChatMessage, ModelName, PendingAttachment, SessionSummary } from '../../shared/types'
import { useProjectStore } from './projectStore'

interface ChatState {
  activeSessionId: string | null
  messages: ChatMessage[]
  pastSessions: SessionSummary[]
  composerText: string
  composerAttachments: PendingAttachment[]
  pendingSend: boolean
  defaultModel: ModelName

  loadForProject: (projectPath: string, projectId: string) => Promise<void>
  sendMessage: () => void
  createNewSession: () => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  clearCurrentSession: () => Promise<void>
  switchModel: (model: ModelName) => void
  appendIncomingMessage: (sessionId: string, message: ChatMessage) => void
  setPendingSend: (v: boolean) => void
  addAttachment: (a: PendingAttachment) => void
  removeAttachment: (id: string) => void
  setComposerText: (text: string) => void
  reset: () => void
}

function activeProject() {
  const { activeProjectId, projects } = useProjectStore.getState()
  return projects.find((p) => p.id === activeProjectId) ?? null
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  pastSessions: [],
  composerText: '',
  composerAttachments: [],
  pendingSend: false,
  defaultModel: 'claude-sonnet-4-6',

  loadForProject: async (projectPath: string, projectId: string) => {
    const [sessions, savedId, savedModel] = await Promise.all([
      window.api.sessionList(projectPath),
      window.api.sessionGetActive(projectId),
      window.api.modelGet(),
    ])

    let sessionId = savedId ?? sessions[0]?.id ?? null
    if (!sessionId) {
      sessionId = await window.api.sessionCreate(projectPath)
    }
    await window.api.sessionSetActive(projectId, sessionId)

    const messages = await window.api.sessionLoad(projectPath, sessionId)
    set({
      activeSessionId: sessionId,
      messages,
      pastSessions: sessions,
      composerText: '',
      composerAttachments: [],
      pendingSend: false,
      defaultModel: savedModel as ModelName,
    })
  },

  sendMessage: () => {
    const project = activeProject()
    const { activeSessionId, composerText, composerAttachments, defaultModel } = get()
    if (!project || !activeSessionId || !composerText.trim()) return

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: composerText.trim(),
      ts: Date.now(),
      ...(composerAttachments.length > 0 && {
        attachments: composerAttachments.map(({ kind, path, name }) => ({
          kind, path, name,
        })),
      }),
    }

    set((s) => ({
      messages: [...s.messages, message],
      composerText: '',
      composerAttachments: [],
      pendingSend: true,
    }))

    // Fire-and-forget — agent completes async via agent:event / chat:message-appended
    window.api.chatSend(project.path, activeSessionId, message, defaultModel, project.id).catch(console.error)
  },

  createNewSession: async () => {
    const project = activeProject()
    if (!project) return
    const sessionId = await window.api.sessionCreate(project.path)
    await window.api.sessionSetActive(project.id, sessionId)
    const sessions = await window.api.sessionList(project.path)
    set({ activeSessionId: sessionId, messages: [], pastSessions: sessions })
  },

  switchSession: async (sessionId: string) => {
    const project = activeProject()
    if (!project) return
    await window.api.sessionSetActive(project.id, sessionId)
    const messages = await window.api.sessionLoad(project.path, sessionId)
    set({ activeSessionId: sessionId, messages })
  },

  clearCurrentSession: async () => {
    const project = activeProject()
    const { activeSessionId } = get()
    if (!project || !activeSessionId) return
    await window.api.sessionClear(project.path, activeSessionId)
    set({ messages: [] })
  },

  switchModel: (model: ModelName) => {
    set({ defaultModel: model })
    window.api.modelSet(model)
  },

  appendIncomingMessage: (sessionId: string, message: ChatMessage) => {
    set((s) => {
      if (s.activeSessionId !== sessionId) return s
      return { messages: [...s.messages, message], pendingSend: false }
    })
  },

  setPendingSend: (v: boolean) => set({ pendingSend: v }),

  addAttachment: (a: PendingAttachment) =>
    set((s) => ({ composerAttachments: [...s.composerAttachments, a] })),

  removeAttachment: (id: string) =>
    set((s) => ({ composerAttachments: s.composerAttachments.filter((a) => a.id !== id) })),

  setComposerText: (text: string) => set({ composerText: text }),

  reset: () =>
    set({
      activeSessionId: null,
      messages: [],
      pastSessions: [],
      composerText: '',
      composerAttachments: [],
      pendingSend: false,
    }),
}))
