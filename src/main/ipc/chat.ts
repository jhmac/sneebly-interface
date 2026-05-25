import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { ChatMessage, ModelName } from '../../shared/types'
import * as sessionStore from '../services/session-store'
import { startTurn, isChatTurnInFlight, type TurnMetrics } from '../services/agent-session'
import { pushAgentEvent } from './agent'
import { sendToProjectWindows } from '../services/window-registry'
import { appendEvent, CORRECTION_RE } from '../services/event-stream'
import { getSkillPrompt } from '../services/skills-loader'
import { composeSystemPromptAddendum } from '../services/system-prompt-composer'

const store = new Store()

// Learnings injected on the first turn of each session (sessionId → status)
const sessionLearningsMap = new Map<string, { sourceReflections: string[]; wordCount: number }>()
// Sessions where the user dismissed the learnings chip
const dismissedSessions = new Set<string>()

function pushMessage(sessionId: string, message: ChatMessage, projectId: string): void {
  sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_MESSAGE_APPENDED, sessionId, message)
}

function maybeRunAutoReview(opts: {
  projectPath: string
  sessionId: string
  projectId: string
  recordEvents: boolean
  metrics: TurnMetrics | undefined
}): void {
  const { projectPath, sessionId, projectId, recordEvents, metrics } = opts
  const appSettings = store.get('appSettings', {}) as Record<string, unknown>
  if ((appSettings['autoSelfReview'] as boolean | undefined) === false) return

  const threshFiles = (appSettings['autoSelfReviewThresholdFiles'] as number | undefined) ?? 3
  const threshLines = (appSettings['autoSelfReviewThresholdLines'] as number | undefined) ?? 100
  const filesCount = metrics?.filesTouched.length ?? 0
  const lines = metrics?.linesChanged ?? 0
  if (filesCount < threshFiles && lines < threshLines) return

  const reviewPrompt = getSkillPrompt('self-review')
  if (!reviewPrompt) return

  const reviewModel = (appSettings['autoSelfReviewModel'] as ModelName | undefined) ?? 'claude-opus-4-7'
  const recordUsage = (appSettings['recordTokenUsage'] as boolean | undefined) ?? true
  const claudeCodeSessionId = store.get(`claudeSessionIds.${sessionId}`, null) as string | null
  let reviewText = ''

  sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: true })

  startTurn(
    {
      cwd: projectPath,
      projectId,
      sneeblySessionId: sessionId,
      claudeCodeSessionId,
      prompt: 'Please perform a self-review of the changes you just made.',
      model: reviewModel,
      appendSystemPrompt: reviewPrompt,
      recordEvents,
      recordUsage,
      isAutoReview: true,
    },
    (event) => {
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        store.set(`claudeSessionIds.${sessionId}`, event.session_id)
      }
      if (event.type === 'assistant') {
        for (const block of event.message.content) {
          if (block.type === 'text') reviewText += block.text
        }
      }
      pushAgentEvent(event, projectId)
    },
    (reviewClaudeSessionId, reviewError) => {
      sendToProjectWindows(projectId, IPC_CHANNELS.CHAT_IN_FLIGHT_CHANGED, { projectId, inFlight: false })

      if (reviewClaudeSessionId) {
        store.set(`claudeSessionIds.${sessionId}`, reviewClaudeSessionId)
      }
      if (reviewError) {
        pushAgentEvent({ type: 'error', message: reviewError }, projectId)
        return
      }
      if (reviewText.trim()) {
        const reviewMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: reviewText.trim(),
          ts: Date.now(),
        }
        sessionStore.appendMessage(projectPath, sessionId, reviewMsg)
        pushMessage(sessionId, reviewMsg, projectId)
      }
    }
  )
}

export function registerChatHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, (_e, projectPath: string) =>
    sessionStore.listSessions(projectPath)
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_LOAD,
    (_e, projectPath: string, sessionId: string) =>
      sessionStore.loadMessages(projectPath, sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, (_e, projectPath: string) =>
    sessionStore.createSession(projectPath)
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_CLEAR,
    (_e, projectPath: string, sessionId: string) => {
      store.delete(`claudeSessionIds.${sessionId}`)
      sessionLearningsMap.delete(sessionId)
      dismissedSessions.delete(sessionId)
      return sessionStore.clearSession(projectPath, sessionId)
    }
  )

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_ACTIVE, (_e, projectId: string) =>
    store.get(`chat.activeSession.${projectId}`, null)
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_SET_ACTIVE,
    (_e, projectId: string, sessionId: string | null) => {
      if (sessionId) {
        store.set(`chat.activeSession.${projectId}`, sessionId)
      } else {
        store.delete(`chat.activeSession.${projectId}`)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.MODEL_GET, () =>
    store.get('chat.defaultModel', 'claude-sonnet-4-6')
  )

  ipcMain.handle(IPC_CHANNELS.MODEL_SET, (_e, model: ModelName) => {
    store.set('chat.defaultModel', model)
  })

  ipcMain.handle(
    IPC_CHANNELS.CHAT_SEND,
    async (_e, projectPath: string, sessionId: string, userMessage: ChatMessage, model: string, projectId: string, skillPrompt?: string, skillId?: string) => {
      if (isChatTurnInFlight(projectId)) {
        const busyMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'Still finishing the previous turn — give me a moment, then send again.',
          ts: Date.now(),
        }
        pushMessage(sessionId, busyMsg, projectId)
        return
      }

      sessionStore.appendMessage(projectPath, sessionId, userMessage)

      const appSettings = store.get('appSettings', {}) as Record<string, unknown>
      const recordEvents = (appSettings['recordEventStream'] as boolean | undefined) ?? true
      const recordUsage = (appSettings['recordTokenUsage'] as boolean | undefined) ?? true

      if (recordEvents) {
        appendEvent(projectPath, sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          projectId,
          ts: userMessage.ts,
          kind: 'user_message',
          source: 'chat',
          payload: {
            text: userMessage.text,
            isCorrection: CORRECTION_RE.test(userMessage.text.trimStart()),
          },
        })

        if (skillId) {
          appendEvent(projectPath, sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            projectId,
            ts: userMessage.ts,
            kind: 'skill_selected',
            source: 'chat',
            payload: { skillId },
          })
        }
      }

      const claudeCodeSessionId = store.get(`claudeSessionIds.${sessionId}`, null) as string | null

      // First turn of this session: compose skill + learnings addendum.
      // Subsequent turns skip learnings to avoid re-injecting every turn.
      const isFirstTurn = claudeCodeSessionId === null
      const applyLearnings = (appSettings['applyLearnings'] as boolean | undefined) ?? true
      const maxAgeDays = (appSettings['learningsMaxAgeDays'] as number | undefined) ?? 14
      const maxWords = (appSettings['learningsMaxWords'] as number | undefined) ?? 800

      let appendSystemPrompt: string | undefined = skillPrompt
      if (isFirstTurn && !dismissedSessions.has(sessionId)) {
        const composed = composeSystemPromptAddendum(projectPath, {
          skillPrompt,
          applyLearnings,
          maxAgeDays,
          maxWords,
        })
        appendSystemPrompt = composed.text ?? undefined

        if (composed.learnings) {
          sessionLearningsMap.set(sessionId, {
            sourceReflections: composed.learnings.sourceReflections,
            wordCount: composed.learnings.wordCount,
          })
          if (recordEvents) {
            appendEvent(projectPath, sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              projectId,
              ts: Date.now(),
              kind: 'learnings_applied',
              source: 'chat',
              payload: {
                learningsHash: composed.learnings.sourceReflections.join('|'),
                sourceReflections: composed.learnings.sourceReflections,
                addendumWordCount: composed.learnings.wordCount,
              },
            })
          }
        }
      }

      let assistantText = ''

      startTurn(
        {
          cwd: projectPath,
          projectId,
          sneeblySessionId: sessionId,
          claudeCodeSessionId,
          prompt: userMessage.text,
          model: model || 'claude-sonnet-4-6',
          appendSystemPrompt,
          recordEvents,
          recordUsage,
        },
        (event) => {
          if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
            store.set(`claudeSessionIds.${sessionId}`, event.session_id)
          }

          // Accumulate assistant text for session persistence
          if (event.type === 'assistant') {
            for (const block of event.message.content) {
              if (block.type === 'text') assistantText += block.text
            }
          }

          pushAgentEvent(event, projectId)
        },
        (claudeSessionId, error, metrics) => {
          if (claudeSessionId) {
            store.set(`claudeSessionIds.${sessionId}`, claudeSessionId)
          }

          if (error) {
            pushAgentEvent({ type: 'error', message: error }, projectId)
          }

          // Always use the Sneebly session ID for JSONL writes
          if (assistantText.trim()) {
            const assistantMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: assistantText.trim(),
              ts: Date.now(),
            }
            sessionStore.appendMessage(projectPath, sessionId, assistantMsg)
            pushMessage(sessionId, assistantMsg, projectId)
          } else if (error) {
            const errMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: `Error: ${error}`,
              ts: Date.now(),
            }
            sessionStore.appendMessage(projectPath, sessionId, errMsg)
            pushMessage(sessionId, errMsg, projectId)
          }

          // Auto-review if thresholds crossed on a successful, non-aborted turn
          if (!error && !metrics?.wasAborted) {
            maybeRunAutoReview({ projectPath, sessionId, projectId, recordEvents, metrics })
          }
        }
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.CHAT_LEARNINGS_STATUS, (_e, projectId: string) => {
    const sessionId = store.get(`chat.activeSession.${projectId}`, null) as string | null
    if (!sessionId || dismissedSessions.has(sessionId)) return null
    return sessionLearningsMap.get(sessionId) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_DISMISS_LEARNINGS, (_e, sessionId: string) => {
    dismissedSessions.add(sessionId)
    sessionLearningsMap.delete(sessionId)
  })
}
