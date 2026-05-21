import type { ChatMessage } from '../../shared/types'
import { appendMessage } from './session-store'

type PushFn = (sessionId: string, message: ChatMessage) => void

export async function sendEchoReply(
  projectPath: string,
  sessionId: string,
  userMessage: ChatMessage,
  push: PushFn
): Promise<void> {
  const delay = 500 + Math.random() * 500
  await new Promise((r) => setTimeout(r, delay))

  let text = `ECHO: ${userMessage.text.toUpperCase()}`
  const n = userMessage.attachments?.length ?? 0
  if (n > 0) text += ` (received ${n} attachment${n === 1 ? '' : 's'})`
  text += '\n\n_Echo backend — Phase 5 replaces this with real Claude._'

  const reply: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    text,
    ts: Date.now(),
  }

  appendMessage(projectPath, sessionId, reply)
  push(sessionId, reply)
}
