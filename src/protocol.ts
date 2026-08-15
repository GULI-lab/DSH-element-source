/**
 * Wire protocol shared by all three halves of dsh-element-source: the page
 * probe script (inject.js), the browser tab (client), and the Node host.
 * This module is pure — JSON-compatible types and pure functions only, so it
 * can be inlined into the browser bundle and the inject IIFE without pulling
 * in node or DOM globals.
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

/** The complete pick payload the probe script posts to the parent page. */
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

/** The host's answer to one resolve request. */
export interface ResolveResult {
  ok: boolean
  /** Absolute path of the located file (always confined to the session cwd). */
  file?: string
  /** The located file relative to the session cwd. */
  relative?: string
  line?: number
  column?: number
  /** The source line (or the surrounding window) as a snippet. */
  snippet?: string
  method: ResolveMethod
  framework: PickFramework
  /** Whether the located file exists on disk. */
  existed: boolean
  /** Whether a steering message was delivered to the session's agent. */
  steered: boolean
  /** Human-readable failure reason when ok is false. */
  error?: string
}

/** postMessage payloads the probe script sends to the parent page. */
export type ProbeToParentMessage =
  | { type: 'dsh-es:hello'; protocolVersion: number }
  | { type: 'dsh-es:pick'; pick: ElementPick }
  | { type: 'dsh-es:pick-cancel' }
  | { type: 'dsh-es:pick-done' }
  | { type: 'dsh-es:select'; pick: ElementPick | null }
  | { type: 'dsh-es:tree'; nodes: TreeNode[] }
  | { type: 'dsh-es:style'; info: StyleInfo | null }

/** postMessage payloads the parent page sends into the probe script. */
export type ParentToProbeMessage =
  | { type: 'dsh-es:set-mode'; mode: boolean }
  | { type: 'dsh-es:ping' }
  | { type: 'dsh-es:get-tree' }
  | { type: 'dsh-es:get-style' }
  | { type: 'dsh-es:clear-selection' }
  | { type: 'dsh-es:select-path'; path: number[] }
  | { type: 'dsh-es:apply-style'; styles: Partial<StylePatch> }

/** One node of the bounded component tree. */
export interface TreeNode {
  /** Index path from the tree root (children[i] walk), stable across renders. */
  path: number[]
  tag: string
  id?: string
  classes: string[]
  /** Trimmed text snippet, capped. */
  text?: string
  children: TreeNode[]
}

/** Editable style patch for the selected element (inline styles). */
export interface StylePatch {
  width?: string
  height?: string
  paddingTop?: string
  paddingRight?: string
  paddingBottom?: string
  paddingLeft?: string
  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string
  /** CSS transform text (e.g. `rotate(15deg)`). */
  transform?: string
}

/** Read-only computed style info of the selected element. */
export interface StyleInfo {
  /** CSS-module/derived class names, joined. */
  display?: string
  position?: string
  /** px values (numbers, computed). */
  x?: number
  y?: number
  width?: number
  height?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  transform?: string
  color?: string
  background?: string
  fontSize?: string
  zIndex?: string
  /** The element's own inline `style` attribute text (for the CSS tab). */
  inlineStyle?: string
}

/** Bounds for the component tree (kept small to stay responsive). */
export const TREE_MAX_DEPTH = 8
export const TREE_MAX_NODES = 240

export const PROTOCOL_VERSION = 1

export const PROBE_MESSAGE_PREFIX = 'dsh-es:'

/** True when a message object carries the probe protocol type marker. */
export function isProbeMessage(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as Record<string, unknown>).type
  return typeof type === 'string' && type.startsWith(PROBE_MESSAGE_PREFIX)
}

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

/**
 * Normalize one address-bar input for the LOCAL preview tab. Unlike the
 * built-in sidebar browser, loopback URLs (localhost / 127.x) are allowed —
 * the whole point of the tab is previewing local dev servers. Anything that
 * is not http(s) is refused.
 */
export type PreviewUrlResult =
  | { kind: 'ok'; url: string }
  | { kind: 'blocked' }
  | { kind: 'invalid' }

const FORBIDDEN_SCHEMES = new Set([
  'javascript', 'data', 'file', 'about', 'vbscript', 'blob',
  'mailto', 'tel', 'ftp', 'ftps', 'ws', 'wss', 'sftp', 'ssh',
  'chrome', 'chrome-extension', 'moz-extension', 'edge', 'opera', 'resource', 'view-source',
])

/** Normalize an address-bar input against the local-preview policy. */
export function normalizePreviewUrl(input: string): PreviewUrlResult {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'invalid' }
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  let withScheme: string
  if (schemeMatch === null) {
    withScheme = `http://${trimmed}`
  } else {
    const scheme = schemeMatch[1]!.toLowerCase()
    if (scheme === 'http' || scheme === 'https') withScheme = trimmed
    else if (FORBIDDEN_SCHEMES.has(scheme)) return { kind: 'blocked' }
    else withScheme = `http://${trimmed}`
  }
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { kind: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'blocked' }
  return { kind: 'ok', url: url.href }
}

/** Sanitize a value that may come from an untrusted page into a plain string. */
export function safeString(value: unknown, fallback = ''): string {
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
