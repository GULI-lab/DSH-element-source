/**
 * Wire protocol shared by the page probe (inject.js), the DSH chat client, and
 * the host. This module is pure — JSON-compatible types and pure functions
 * only — so it can be inlined into the inject IIFE without pulling in node or
 * DOM globals.
 */

/** Frameworks the probe chain can identify. */
export type PickFramework =
  | 'code-inspector' // data-insp-* attributes left by code-inspector-plugin
  | 'react'
  | 'vue'
  | 'svelte'
  | 'angular'
  | 'generic'

/** One precise-or-heuristic source location collected in the page. */
export interface PickSource {
  /** Absolute or project-relative source file as reported by the framework. */
  file: string
  line?: number
  column?: number
}

/** A minimal element descriptor for fallback text/class search on the host. */
export interface ElementDescriptor {
  tag: string
  id?: string
  /** Lowercase class names, deduplicated. */
  classes: string[]
  /** Trimmed text content, capped. */
  text?: string
  /** Short CSS selector path (element and its ancestors), capped. */
  selector: string
  /** A bounded sample of attribute names; values are capped. */
  attrs: Array<[string, string]>
}

/** The pick payload the probe script posts to the DSH host. */
export interface ElementPick {
  protocolVersion: number
  framework: PickFramework
  /** The best source found among the element and its ancestors. */
  source?: PickSource
  /** Component / instance display name when the framework reported one. */
  name?: string
  element: ElementDescriptor
  /** The page URL the pick happened on. */
  pageUrl: string
}

/** How the host resolved the pick to a file. */
export type ResolveMethod =
  | 'code-inspector'
  | 'react-source'
  | 'vue-file'
  | 'svelte-source'
  | 'text-search'
  | 'component-search'
  | 'none'

/**
 * One resolved queued pick returned to the DSH chat client poller. The client
 * only needs the display location; resolution happens host-side inside the
 * session workspace, so nothing here can escape that confinement.
 */
export interface PendingResult {
  /** Queue sequence of the pick this entry answers. */
  seq: number
  ok: boolean
  /** The located file relative to the session workspace. */
  relative?: string
  line?: number
  column?: number
  /** The source line (or the surrounding window) as a snippet. */
  snippet?: string
  method?: ResolveMethod
  framework?: PickFramework
  /** Human-readable failure reason when ok is false. */
  error?: string
}

export const PROTOCOL_VERSION = 1

/** Cap a string to `limit` code points, appending an ellipsis when truncated. */
export function capText(value: string, limit: number): string {
  const points = Array.from(value)
  if (points.length <= limit) return value
  return `${points.slice(0, limit).join('')}…`
}

/** Normalize whitespace runs and trim an element's text for search. */
export function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** A bounded list of unique lowercase class names. */
export function classList(classes: readonly (string | null | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const cls of classes) {
    if (typeof cls !== 'string' || cls === '') continue
    for (const part of cls.trim().split(/\s+/)) {
      if (part === '' || seen.has(part)) continue
      seen.add(part)
      out.push(part)
    }
    if (out.length >= 16) break
  }
  return out
}

/** Sanitize a value that may come from an untrusted page into a plain string. */
function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Normalize an unknown `pick` payload into an ElementPick (or undefined). */
export function pickFromUnknown(value: unknown): ElementPick | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const element = record.element
  if (typeof element !== 'object' || element === null) return undefined
  const el = element as Record<string, unknown>
  const source = record.source
  const framework = typeof record.framework === 'string' ? record.framework as PickFramework : 'generic'
  const classes = Array.isArray(el.classes)
    ? el.classes.filter((item): item is string => typeof item === 'string').slice(0, 16)
    : []
  const attrs = Array.isArray(el.attrs)
    ? el.attrs
        .filter((item): item is [string, string] => Array.isArray(item) && item.length === 2
          && typeof item[0] === 'string' && typeof item[1] === 'string')
        .slice(0, 16)
    : []
  const name = safeString(record.name)
  const sourceFile = typeof source === 'object' && source !== null
    ? safeString((source as Record<string, unknown>).file)
    : ''
  return {
    protocolVersion: typeof record.protocolVersion === 'number' ? record.protocolVersion : 0,
    framework,
    source: sourceFile === ''
      ? undefined
      : {
          file: sourceFile,
          line: typeof (source as Record<string, unknown>).line === 'number'
            ? (source as Record<string, unknown>).line as number
            : undefined,
          column: typeof (source as Record<string, unknown>).column === 'number'
            ? (source as Record<string, unknown>).column as number
            : undefined,
        },
    name: name === '' ? undefined : name,
    element: {
      tag: safeString(el.tag, 'div'),
      id: safeString(el.id) || undefined,
      classes,
      text: safeString(el.text) || undefined,
      selector: safeString(el.selector),
      attrs,
    },
    pageUrl: safeString(record.pageUrl),
  }
}
