/**
 * Chat-draft helpers. After a pick, the located source is placed into the
 * session composer DRAFT (never sent): the user adds their own wording and
 * decides when to send. Follows the same lazy conversation-service pattern as
 * dsh-better-sidebar's @-mention insertion.
 */
import type { ResolveResult } from '../protocol.ts'
import type { Context } from '../context-types.ts'

/** The draft text for one located source (agent-facing `[元素定位]` tag). */
export function buildDraftText(result: ResolveResult): string {
  const location = result.line !== undefined ? `${result.relative}:${result.line}` : (result.relative ?? '')
  return `[元素定位] ${location}`
}

/** The composer input face (structural mirror of ui-conversation's input). */
interface ConversationInput {
  for(actx: unknown): {
    state: { getSnapshot(): { draft: string } }
    setDraft(text: string): void
  }
}

interface ConversationLike {
  input: ConversationInput
}

/** The client sessions face used to reach a session's agent-scoped context. */
interface SessionsScopeLike {
  sessions?: { scope?(id: string): unknown }
}

/**
 * Append a located source to the session's composer draft. Never sends
 * anything; returns false (logged, no throw) when the conversation service or
 * session scope is unavailable.
 */
export function appendToDraft(ctx: Context, sessionId: string, text: string): boolean {
  try {
    const actx = (ctx as unknown as SessionsScopeLike).sessions?.scope?.(sessionId)
    if (actx === undefined) return false
    const conversation = ctx.reflect.get('conversation') as ConversationLike | undefined
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(draft.trim() === '' ? text : `${draft} ${text}`)
    return true
  } catch (error) {
    console.warn('[dsh-element-source] draft fill failed:', error)
    return false
  }
}
