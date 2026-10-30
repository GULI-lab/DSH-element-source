/**
 * Chat-draft helpers. After a pick, the located source is placed into the
 * session composer DRAFT (never sent) as a FILE REFERENCE CHIP — the same
 * semantic reference the built-in `@` file menu produces — so the composer and
 * the sent message both show a compact chip instead of a long path line.
 */

/** The minimal structural context face the draft helper needs (satisfied by
 *  the DSH client Context). */
interface DraftContext {
  reflect: { get(name: string): unknown }
  sessions?: { scope?(id: string): unknown }
}

/** The session-scoped context face that exposes the conversation service in
 *  DSH 0.2.x. */
interface SessionScopeLike {
  get?(name: string): unknown
}

/** One semantic-draft reference (a chip) as the composer stores it. */
interface DraftReference {
  /** Serializer routing key; file mentions use `reference`. */
  source: string
  /** Owner-scoped reference id (the `@path` mention text for files). */
  ref: string
  /** Inline display label. */
  label: string
  /** Domain glyph. */
  appearance?: 'session' | 'file' | 'folder'
  /** Clipboard projection; must equal the mention text span. */
  clipboardText: string
}

/** The draft text for one located source (fallback plain text). */
export function buildDraftText(result: { relative?: string; line?: number }): string {
  const relative = result.relative ?? ''
  const location = result.line !== undefined ? `${relative}:${result.line}` : relative
  return `[元素定位] ${location}`
}

/** The workspace-relative path as the `@` file menu spells it (POSIX slashes). */
function mentionPath(relative: string): string {
  return relative.replace(/\\/g, '/')
}

/** The `@path` mention text of one located source (quoted when it has spaces). */
export function buildMention(relative: string): string {
  const path = mentionPath(relative)
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

/** The reference chip payload of one located source. */
export function buildReference(relative: string, line?: number): DraftReference {
  const mention = buildMention(relative)
  const path = mentionPath(relative)
  const base = path.slice(path.lastIndexOf('/') + 1)
  return {
    source: 'reference',
    ref: mention,
    label: line !== undefined ? `${base}:${line}` : base,
    appearance: 'file',
    clipboardText: mention,
  }
}

/** The composer input face (structural mirror of ui-conversation's input). */
interface ConversationInput {
  for(actx: unknown): {
    state: { getSnapshot(): { draft: string } }
    setDraft(text: string): void
    /** The shell-owned draft editor (exposes the reference insertion API). */
    draftEditor?: { insertFileReferences(references: DraftReference[]): boolean }
  }
}

interface ConversationLike {
  input: ConversationInput
}

/** Resolve the conversation service for one session (0.2.x session scope first). */
function conversationOf(ctx: DraftContext, scope: unknown): ConversationLike | undefined {
  const scoped = scope as SessionScopeLike
  if (typeof scoped.get === 'function') {
    const fromScope = scoped.get('conversation') as ConversationLike | undefined
    if (fromScope !== undefined) return fromScope
  }
  return ctx.reflect.get('conversation') as ConversationLike | undefined
}

/**
 * Insert a located source into the session's composer draft as a file
 * reference chip (falling back to plain `[元素定位]` text when the chip API is
 * unavailable). Never sends anything; returns false (logged, no throw) when the
 * conversation service or session scope is unavailable.
 */
export function insertLocatedSource(
  ctx: DraftContext,
  sessionId: string,
  relative: string,
  line?: number,
): boolean {
  try {
    const scope = ctx.sessions?.scope?.(sessionId)
    if (scope === undefined) return false
    const conversation = conversationOf(ctx, scope)
    if (conversation === undefined) return false
    const input = conversation.input.for(scope)
    const reference = buildReference(relative, line)
    const editor = input.draftEditor
    if (editor !== undefined && typeof editor.insertFileReferences === 'function'
      && editor.insertFileReferences([reference])) {
      return true
    }
    // Fallback: plain text (drops nothing else when the draft was empty).
    const current = input.state.getSnapshot().draft
    const text = buildDraftText({ relative, line })
    input.setDraft(current.trim() === '' ? text : `${current} ${text}`)
    return true
  } catch (error) {
    console.warn('[dsh-element-source] draft fill failed:', error)
    return false
  }
}
