import { create } from 'zustand'
import { useChatStore } from './chatStore'
import type {
  AgentEvent,
  AgentContentToolUse,
  ActivityCardData,
  CardType,
  ThinkingCard,
  ReadCard,
  EditCard,
  WriteCard,
  BashCard,
  SearchCard,
  WebFetchCard,
  TaskCard,
  SummaryCard,
  ErrorCard,
} from '../../shared/types'

const READ_TOOLS = new Set(['Read', 'View', 'ReadFile'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'EditFile'])
const WRITE_TOOLS = new Set(['Write', 'WriteFile', 'Create'])
const BASH_TOOLS = new Set(['Bash', 'Shell', 'Execute'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'Search', 'FindFiles', 'Find'])
const WEBFETCH_TOOLS = new Set(['WebFetch', 'Fetch', 'Browser'])
const TASK_TOOLS = new Set(['Task', 'Agent', 'SubAgent'])

export interface TurnState {
  startedAt: number
  sessionId: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  active: boolean
  aborted: boolean
  toolCallCount: number
  currentActivity: string
}

interface ActivityState {
  cards: ActivityCardData[]
  currentTurn: TurnState | null
  filters: Record<CardType, boolean>
  pendingSessionId: string | null

  appendEvent: (event: AgentEvent) => void
  startTurn: (sessionId: string | null) => void
  abortTurn: () => void
  respondToPermission: (requestId: string, decision: 'allow' | 'deny') => void
  toggleFilter: (cardType: CardType) => void
  reset: () => void
}

const DEFAULT_FILTERS: Record<CardType, boolean> = {
  thinking: true, read: true, edit: true, write: true, bash: true,
  search: true, webfetch: true, task: true, permission: true, error: true, summary: true,
}

function toolNameToCardType(name: string): CardType | null {
  if (READ_TOOLS.has(name)) return 'read'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (WRITE_TOOLS.has(name)) return 'write'
  if (BASH_TOOLS.has(name)) return 'bash'
  if (SEARCH_TOOLS.has(name)) return 'search'
  if (WEBFETCH_TOOLS.has(name)) return 'webfetch'
  if (TASK_TOOLS.has(name)) return 'task'
  return null
}

function activityLabel(toolName: string, input: Record<string, unknown>): string {
  if (READ_TOOLS.has(toolName)) {
    const f = (input['file_path'] ?? input['path'] ?? '') as string
    return `Reading ${f.split('/').pop() ?? f}…`
  }
  if (EDIT_TOOLS.has(toolName)) {
    const f = (input['file_path'] ?? input['path'] ?? '') as string
    return `Editing ${f.split('/').pop() ?? f}…`
  }
  if (WRITE_TOOLS.has(toolName)) {
    const f = (input['file_path'] ?? input['path'] ?? '') as string
    return `Writing ${f.split('/').pop() ?? f}…`
  }
  if (BASH_TOOLS.has(toolName)) return `Running command…`
  if (SEARCH_TOOLS.has(toolName)) return `Searching…`
  if (WEBFETCH_TOOLS.has(toolName)) return `Fetching web…`
  if (TASK_TOOLS.has(toolName)) return `Running task…`
  return `Using ${toolName}…`
}

function toolUseToCard(block: AgentContentToolUse, ts: number): ActivityCardData | null {
  const { id, name, input } = block
  const base = { id: `card-${id}`, ts }

  if (READ_TOOLS.has(name)) {
    return {
      ...base, cardType: 'read', toolUseId: id,
      filePath: (input['file_path'] ?? input['path'] ?? '') as string,
      startLine: input['start_line'] as number | undefined,
      endLine: input['end_line'] as number | undefined,
    } satisfies ReadCard
  }
  if (EDIT_TOOLS.has(name)) {
    return {
      ...base, cardType: 'edit', toolUseId: id,
      filePath: (input['file_path'] ?? input['path'] ?? '') as string,
      oldContent: input['old_string'] as string | undefined,
      newContent: input['new_string'] as string | undefined,
    } satisfies EditCard
  }
  if (WRITE_TOOLS.has(name)) {
    return {
      ...base, cardType: 'write', toolUseId: id,
      filePath: (input['file_path'] ?? input['path'] ?? '') as string,
      content: input['content'] as string | undefined,
    } satisfies WriteCard
  }
  if (BASH_TOOLS.has(name)) {
    return {
      ...base, cardType: 'bash', toolUseId: id,
      command: (input['command'] ?? '') as string,
    } satisfies BashCard
  }
  if (SEARCH_TOOLS.has(name)) {
    return {
      ...base, cardType: 'search', toolUseId: id, toolName: name,
      pattern: (input['pattern'] ?? input['glob'] ?? input['regex'] ?? '') as string,
    } satisfies SearchCard
  }
  if (WEBFETCH_TOOLS.has(name)) {
    return {
      ...base, cardType: 'webfetch', toolUseId: id,
      url: (input['url'] ?? '') as string,
    } satisfies WebFetchCard
  }
  if (TASK_TOOLS.has(name)) {
    return {
      ...base, cardType: 'task', toolUseId: id,
      description: (input['description'] ?? input['prompt'] ?? '') as string,
    } satisfies TaskCard
  }
  return null
}

function getResultText(content: string | Array<{type: string; text?: string}>): string {
  if (typeof content === 'string') return content
  return content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  cards: [],
  currentTurn: null,
  filters: { ...DEFAULT_FILTERS },
  pendingSessionId: null,

  appendEvent: (event: AgentEvent) => {
    const ts = Date.now()

    if (event.type === 'system' && event.subtype === 'init') {
      set((s) => ({
        currentTurn: s.currentTurn
          ? { ...s.currentTurn, sessionId: event.session_id, active: true }
          : {
              startedAt: ts, sessionId: event.session_id,
              tokensIn: 0, tokensOut: 0, costUsd: 0,
              active: true, aborted: false, toolCallCount: 0,
              currentActivity: 'Starting…',
            },
      }))
      return
    }

    if (event.type === 'assistant') {
      const newCards: ActivityCardData[] = []
      let toolCallCount = get().currentTurn?.toolCallCount ?? 0
      let currentActivity = get().currentTurn?.currentActivity ?? 'Thinking…'

      for (const block of event.message.content) {
        if (block.type === 'thinking') {
          newCards.push({ id: `think-${ts}-${Math.random()}`, ts, cardType: 'thinking', text: block.thinking } satisfies ThinkingCard)
          currentActivity = 'Thinking…'
        } else if (block.type === 'text' && block.text.trim()) {
          newCards.push({ id: `summary-${ts}-${Math.random()}`, ts, cardType: 'summary', text: block.text } satisfies SummaryCard)
        } else if (block.type === 'tool_use') {
          const card = toolUseToCard(block, ts)
          if (card) newCards.push(card)
          currentActivity = activityLabel(block.name, block.input)
          toolCallCount++
        }
      }

      set((s) => ({
        cards: [...s.cards, ...newCards],
        currentTurn: s.currentTurn
          ? { ...s.currentTurn, toolCallCount, currentActivity }
          : null,
      }))
      return
    }

    if (event.type === 'user') {
      // Match tool results back to their cards
      const updates = new Map<string, { resultContent?: string; isError?: boolean }>()
      for (const block of event.message.content) {
        if (block.type === 'tool_result') {
          updates.set(block.tool_use_id, {
            resultContent: getResultText(block.content as string | Array<{type:string;text?:string}>),
            isError: block.is_error,
          })
        }
      }
      if (updates.size === 0) return
      set((s) => ({
        cards: s.cards.map((card) => {
          if (!('toolUseId' in card)) return card
          const upd = updates.get((card as ReadCard).toolUseId)
          if (!upd) return card
          return { ...card, ...upd }
        }),
      }))
      return
    }

    if (event.type === 'result') {
      const tokensIn = event.usage?.input_tokens ?? 0
      const tokensOut = event.usage?.output_tokens ?? 0
      set((s) => ({
        currentTurn: s.currentTurn
          ? {
              ...s.currentTurn,
              tokensIn, tokensOut,
              costUsd: event.total_cost_usd ?? 0,
              active: false,
              currentActivity: 'Idle',
            }
          : null,
      }))
      // Turn is complete — composer re-enables via chat:message-appended,
      // but abort could have left pendingSend stuck; clear defensively.
      return
    }

    if (event.type === 'error') {
      const card: ErrorCard = { id: `err-${ts}`, ts, cardType: 'error', message: event.message }
      set((s) => ({
        cards: [...s.cards, card],
        currentTurn: s.currentTurn ? { ...s.currentTurn, active: false, currentActivity: 'Error' } : null,
      }))
      useChatStore.getState().setPendingSend(false)
    }
  },

  startTurn: (sessionId) => {
    set({
      currentTurn: {
        startedAt: Date.now(),
        sessionId,
        tokensIn: 0, tokensOut: 0, costUsd: 0,
        active: true, aborted: false,
        toolCallCount: 0, currentActivity: 'Starting…',
      },
    })
  },

  abortTurn: () => {
    const { currentTurn } = get()
    if (!currentTurn?.active) return
    // Use Sneebly session ID (the process map key in agent-session.ts)
    const sneeblySessionId = useChatStore.getState().activeSessionId
    if (sneeblySessionId) window.api.agentAbort(sneeblySessionId)
    set((s) => ({
      currentTurn: s.currentTurn
        ? { ...s.currentTurn, active: false, aborted: true, currentActivity: 'Aborted' }
        : null,
    }))
    useChatStore.getState().setPendingSend(false)
  },

  respondToPermission: (requestId, decision) => {
    window.api.agentPermissionResponse(requestId, decision)
    set((s) => ({
      cards: s.cards.map((c) =>
        c.cardType === 'permission' && (c as import('../../shared/types').PermissionCard).requestId === requestId
          ? { ...c, decision }
          : c
      ),
    }))
  },

  toggleFilter: (cardType) => {
    set((s) => ({
      filters: { ...s.filters, [cardType]: !s.filters[cardType] },
    }))
  },

  reset: () => set({ cards: [], currentTurn: null }),
}))
