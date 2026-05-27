import { EventEmitter } from 'node:events'

// ─── Typed event map ──────────────────────────────────────────────────────────

// Add entries here as new cross-service events are needed.
// Convention: 'subsystem:event-name', args tuple.
type AgentBusEventMap = {
  'review:done': [projectId: string, milestoneId: string]
}

// ─── Typed emitter ────────────────────────────────────────────────────────────

class AgentBus extends EventEmitter {
  emit<K extends keyof AgentBusEventMap>(event: K, ...args: AgentBusEventMap[K]): boolean {
    return super.emit(event as string, ...args)
  }

  on<K extends keyof AgentBusEventMap>(
    event: K,
    listener: (...args: AgentBusEventMap[K]) => void,
  ): this {
    return super.on(event as string, listener as (...a: unknown[]) => void)
  }

  once<K extends keyof AgentBusEventMap>(
    event: K,
    listener: (...args: AgentBusEventMap[K]) => void,
  ): this {
    return super.once(event as string, listener as (...a: unknown[]) => void)
  }

  off<K extends keyof AgentBusEventMap>(
    event: K,
    listener: (...args: AgentBusEventMap[K]) => void,
  ): this {
    return super.off(event as string, listener as (...a: unknown[]) => void)
  }
}

// Singleton — import { agentBus } everywhere; never recreate.
export const agentBus = new AgentBus()
