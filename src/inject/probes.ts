/**
 * Framework probes for the page-side inject script. Each probe reads a real
 * dev-runtime signal off a DOM-like element and returns a precise or
 * heuristic source location. Pure functions over a minimal element contract
 * so they run inside the inject IIFE and are unit-testable in Node.
 *
 * Probe priority (first match wins, per node):
 *  1. code-inspector-plugin `data-insp-*` attributes — exact for every
 *     framework when the user also uses code-inspector-plugin.
 *  2. React dev `__source` on the nearest fiber's memoizedProps — exact
 *     file:line:col from the JSX transform (@vitejs/plugin-react, CRA).
 *  3. Vue dev `__file` on `__vueParentComponent.type` (v3) or
 *     `__vue__.$options` (v2) — exact file.
 *  4. Svelte dev `__svelte_meta` — exact file:line:col when present.
 *  5. Angular dev markers (`ng-reflect-*`, `_nghost-*`) — framework only,
 *     resolution falls back to the workspace search.
 */
import { capText, classList, normalizeSearchText, type ElementDescriptor, type PickFramework, type PickSource } from '../protocol.ts'

/** The minimal DOM-like contract the probes need (satisfied by real elements). */
export interface ProbeElement {
  tagName?: string
  id?: string
  className?: unknown
  textContent?: string | null
  parentElement: ProbeElement | null
  attributes?: NamedNodeMap | ProbeAttribute[] | { [name: string]: unknown }
  getAttribute?(name: string): string | null
  [key: string]: unknown
}

/** A DOM attribute row (element.attributes is an iterable NamedNodeMap). */
interface ProbeAttribute {
  name: string
  value: string
}

/** One probe result for a node. */
interface ProbeResult {
  framework: PickFramework
  source?: PickSource
  name?: string
}

/** Attributes code-inspector-plugin injects onto rendered elements. */
const INSP_PATH = 'data-insp-path'
const INSP_ROW = 'data-insp-row'
const INSP_COL = 'data-insp-col'

function attributeOf(el: ProbeElement, name: string): string | null {
  if (typeof el.getAttribute === 'function') return el.getAttribute(name)
  const attrs = el.attributes
  if (attrs === undefined) return null
  if (Array.isArray(attrs)) {
    const row = attrs.find(item => item.name === name)
    return row === undefined ? null : row.value
  }
  if (typeof (attrs as { length?: unknown }).length === 'number') {
    for (const item of Array.from(attrs as Iterable<ProbeAttribute>)) {
      if (item.name === name) return item.value
    }
    return null
  }
  const record = attrs as { [name: string]: unknown }
  const value = record[name]
  return typeof value === 'string' ? value : null
}

/** The attribute names of one element (all three DOM shapes). */
function attributeNamesOf(el: ProbeElement): string[] {
  const attrs = el.attributes
  if (attrs === undefined) return []
  if (Array.isArray(attrs)) return attrs.map(item => item.name)
  if (typeof (attrs as { length?: unknown }).length === 'number') {
    return Array.from(attrs as Iterable<ProbeAttribute>).map(item => item.name)
  }
  return Object.keys(attrs)
}

/** code-inspector-plugin's injected DOM attributes — exact for all frameworks. */
export function probeCodeInspector(el: ProbeElement): ProbeResult | null {
  const file = attributeOf(el, INSP_PATH)
  if (file === null || file === '') return null
  const row = attributeOf(el, INSP_ROW)
  const col = attributeOf(el, INSP_COL)
  return {
    framework: 'code-inspector',
    source: {
      file,
      line: row !== null ? Number(row) || undefined : undefined,
      column: col !== null ? Number(col) || undefined : undefined,
    },
  }
}

/** The React internal key on a DOM node (fiber or legacy instance). */
function reactKeyOf(el: ProbeElement): string | undefined {
  for (const key of Object.keys(el)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) return key
  }
  return undefined
}

/** A fiber-like object: type + memoizedProps + return. */
interface FiberLike {
  type?: unknown
  elementType?: unknown
  memoizedProps?: Record<string, unknown> | null
  return?: FiberLike | null
}

function fiberTypeName(type: unknown): string | undefined {
  // React text and host fibers carry a null elementType/type, and `typeof null`
  // is 'object' — without the explicit null check reading `.displayName` throws
  // and aborts the whole pick.
  if (type === null || (typeof type !== 'function' && typeof type !== 'object')) return undefined
  const record = type as Record<string, unknown>
  const name = typeof record.displayName === 'string'
    ? record.displayName
    : typeof record.name === 'string' ? record.name : undefined
  return name
}

/**
 * React probe: exact `__source` from the nearest fiber's memoizedProps when
 * the JSX transform injects it (@vitejs/plugin-react, CRA). Compilers that do
 * NOT inject `__source` (notably @vitejs/plugin-react-swc) still yield the
 * component display name, which the host turns into a component-definition
 * search.
 */
export function probeReact(el: ProbeElement): ProbeResult | null {
  const key = reactKeyOf(el)
  if (key === undefined) return null
  const fiber = el[key] as FiberLike | null | undefined
  if (fiber === null || typeof fiber !== 'object') return null
  let current: FiberLike | null | undefined = fiber
  let name: string | undefined
  while (current !== null && current !== undefined) {
    if (name === undefined) name = fiberTypeName(current.elementType ?? current.type)
    const props = current.memoizedProps
    const source = props?.__source
    if (typeof source === 'object' && source !== null) {
      const record = source as Record<string, unknown>
      if (typeof record.fileName === 'string') {
        return {
          framework: 'react',
          name: fiberTypeName(current.elementType ?? current.type),
          source: {
            file: record.fileName,
            line: typeof record.lineNumber === 'number' ? record.lineNumber : undefined,
            column: typeof record.columnNumber === 'number' ? record.columnNumber + 1 : undefined,
          },
        }
      }
    }
    current = current.return
  }
  // No __source (e.g. SWC): report the innermost component name so the host
  // can still locate its definition.
  return name === undefined ? null : { framework: 'react', name }
}

/** Vue 3 / Vue 2 dev `__file` off the element's owning component. */
export function probeVue(el: ProbeElement): ProbeResult | null {
  let node: ProbeElement | null = el
  while (node !== null) {
    // Vue 3: element -> __vueParentComponent -> type.__file
    const parentComponent = node.__vueParentComponent
    if (typeof parentComponent === 'object' && parentComponent !== null) {
      const type = (parentComponent as Record<string, unknown>).type
      if (typeof type === 'object' && type !== null) {
        const record = type as Record<string, unknown>
        const file = typeof record.__file === 'string' ? record.__file : undefined
        if (file !== undefined) {
          return {
            framework: 'vue',
            name: typeof record.__name === 'string'
              ? record.__name
              : typeof record.name === 'string' ? record.name : undefined,
            source: { file },
          }
        }
      }
    }
    // Vue 2: element -> __vue__ -> $options.__file
    const vue = node.__vue__
    if (typeof vue === 'object' && vue !== null) {
      const options = (vue as Record<string, unknown>).$options
      if (typeof options === 'object' && options !== null) {
        const file = (options as Record<string, unknown>).__file
        if (typeof file === 'string' && file !== '') {
          return { framework: 'vue', source: { file } }
        }
      }
    }
    node = node.parentElement
  }
  return null
}

/** Svelte 5 dev `__svelte_meta` (template source location). */
export function probeSvelte(el: ProbeElement): ProbeResult | null {
  let node: ProbeElement | null = el
  while (node !== null) {
    const meta = node.__svelte_meta
    if (typeof meta === 'object' && meta !== null) {
      const record = meta as Record<string, unknown>
      const loc = record.loc
      if (typeof loc === 'object' && loc !== null) {
        const locRecord = loc as Record<string, unknown>
        const file = typeof locRecord.file === 'string'
          ? locRecord.file
          : typeof locRecord.fileName === 'string' ? locRecord.fileName : undefined
        if (file !== undefined) {
          return {
            framework: 'svelte',
            source: {
              file,
              line: typeof locRecord.line === 'number' ? locRecord.line : undefined,
              column: typeof locRecord.column === 'number' ? locRecord.column : undefined,
            },
          }
        }
      }
    }
    node = node.parentElement
  }
  return null
}

/** Angular dev markers: `ng-reflect-*` inputs or `_nghost-*` host classes. */
export function probeAngular(el: ProbeElement): ProbeResult | null {
  let node: ProbeElement | null = el
  while (node !== null) {
    const ngContext = node.__ngContext__
    if (typeof ngContext !== 'undefined' && ngContext !== null) return { framework: 'angular' }
    const names = attributeNamesOf(node)
    if (names.some(name => name.startsWith('ng-reflect-') || name.startsWith('_nghost-') || name.startsWith('_ngcontent-'))) {
      return { framework: 'angular' }
    }
    node = node.parentElement
  }
  return null
}

/** Run the probe chain for one node; null when nothing framework-specific matched. */
function probeNode(el: ProbeElement): ProbeResult | null {
  return probeCodeInspector(el)
    ?? probeReact(el)
    ?? probeVue(el)
    ?? probeSvelte(el)
    ?? probeAngular(el)
}

/** Collect the probe results for an element and its ancestors (up to depth). */
export function probeChain(el: ProbeElement, depth = 5): Array<{ node: ProbeElement; result: ProbeResult }> {
  const out: Array<{ node: ProbeElement; result: ProbeResult }> = []
  let node: ProbeElement | null = el
  let count = 0
  while (node !== null && count < depth) {
    const result = probeNode(node)
    if (result !== null) out.push({ node, result })
    node = node.parentElement
    count += 1
  }
  return out
}

/**
 * Pick the best source across the element and its ancestors: the deepest
 * exact hit (line present) wins, then the deepest file-only hit, then
 * nothing (framework still reported for display).
 */
export function bestProbeResult(results: Array<{ result: ProbeResult }>): ProbeResult | null {
  if (results.length === 0) return null
  return results.find(item => item.result.source?.line !== undefined)?.result
    ?? results.find(item => item.result.source !== undefined)?.result
    ?? results[0]!.result
}

/** The element's tag name, lowercased. */
function tagOf(el: ProbeElement): string {
  if (typeof el.tagName === 'string' && el.tagName !== '') return el.tagName.toLowerCase()
  return 'div'
}

/** The element's class names (handles string className and SVGAnimatedString). */
function classesOf(el: ProbeElement): string[] {
  const raw = el.className
  if (typeof raw === 'string') return classList([raw])
  if (typeof raw === 'object' && raw !== null && typeof (raw as { baseVal?: unknown }).baseVal === 'string') {
    return classList([(raw as { baseVal: string }).baseVal])
  }
  return []
}

/** Sample attribute rows (bounded). */
function attributesOf(el: ProbeElement, cap = 12, valueCap = 40): Array<[string, string]> {
  const attrs = el.attributes
  if (attrs === undefined) return []
  const rows: Array<[string, string]> = []
  const push = (name: string, value: string): void => {
    if (rows.length >= cap) return
    rows.push([name, capText(value, valueCap)])
  }
  if (Array.isArray(attrs)) {
    for (const item of attrs) push(item.name, item.value)
  } else if (typeof (attrs as { length?: unknown }).length === 'number') {
    for (const item of Array.from(attrs as Iterable<ProbeAttribute>)) push(item.name, item.value)
  } else {
    const record = attrs as { [name: string]: unknown }
    for (const name of Object.keys(record)) {
      const value = record[name]
      if (typeof value === 'string') push(name, value)
    }
  }
  return rows
}

/** Build a short CSS selector path (element up to 5 ancestors). */
function selectorOf(el: ProbeElement): string {
  const parts: string[] = []
  let node: ProbeElement | null = el
  let depth = 0
  while (node !== null && depth < 5) {
    const tag = tagOf(node)
    let piece = tag
    if (typeof node.id === 'string' && node.id !== '') piece += `#${node.id}`
    const classes = classesOf(node).slice(0, 2)
    if (classes.length > 0) piece += `.${classes.join('.')}`
    parts.push(piece)
    if (tag === 'body' || tag === 'html') break
    node = node.parentElement
    depth += 1
  }
  return parts.reverse().join(' > ')
}

/** Build the full element descriptor for one node. */
export function describeElement(el: ProbeElement): ElementDescriptor {
  const text = typeof el.textContent === 'string' ? normalizeSearchText(el.textContent) : ''
  return {
    tag: tagOf(el),
    id: typeof el.id === 'string' && el.id !== '' ? el.id : undefined,
    classes: classesOf(el),
    text: text === '' ? undefined : capText(text, 120),
    selector: selectorOf(el),
    attrs: attributesOf(el),
  }
}
