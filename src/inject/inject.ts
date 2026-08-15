/**
 * dsh-element-source page probe (built to lib/inject.js). Load it in your dev
 * page — one <script> tag, or the bundled Vite plugin injects it for you:
 *
 *   <script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>
 *
 * The script idles until the DSH page (the parent window) sends a
 * `dsh-es:set-mode` message. While select mode is on it draws a hover outline
 * and, on click, KEEPS the selection (persistent green box) and posts the
 * element's framework metadata back to the parent via postMessage — which
 * works even from the sandboxed sidebar iframe (cross-origin postMessage
 * needs no same-origin privileges). The parent can also request the bounded
 * component tree, the selected element's style info, apply style patches, and
 * select an element by its tree path.
 *
 * This entry has no exports: it is a plain side-effecting script.
 */
import {
  bestProbeResult,
  describeElement,
  elementAtPath,
  probeChain,
  styleInfoOf,
  stylePatchCss,
  tagOf,
  treeOf,
  type ProbeElement,
} from './probes.ts'
import {
  PROTOCOL_VERSION,
  type ElementPick,
  type ParentToProbeMessage,
  type ProbeToParentMessage,
  type StyleInfo,
  type StylePatch,
} from '../protocol.ts'

const MARKER = '__dshElementSourceInstalled__'

// Guard: the script may be loaded twice (HMR, multiple tabs share nothing,
// but a page can double-include). One live instance per page.
const win = window as unknown as Record<string, unknown>
if (win[MARKER] !== true) {
  win[MARKER] = true

  const post = (message: ProbeToParentMessage): void => {
    try {
      window.parent.postMessage(message, '*')
    } catch {
      // No parent (page opened directly): nothing to report to.
    }
  }

  /** The real dev URL the proxy injected (for the probe's pageUrl). */
  const targetPageUrl = typeof win.__DSH_ES_TARGET__ === 'string'
    ? win.__DSH_ES_TARGET__ as string
    : window.location.href

  const elementOf = (el: unknown): ProbeElement => el as ProbeElement

  const buildPick = (el: ProbeElement): ElementPick => {
    const chain = probeChain(el)
    const best = bestProbeResult(chain)
    return {
      protocolVersion: PROTOCOL_VERSION,
      framework: best?.framework ?? 'generic',
      source: best?.source,
      name: best?.name,
      element: describeElement(el),
      pageUrl: targetPageUrl,
    }
  }

  /** Selection mode and DOM handles. */
  let active = false
  let selected: HTMLElement | null = null
  let outline: HTMLElement | null = null
  let tooltip: HTMLElement | null = null
  let hovered: HTMLElement | null = null

  const ensureOverlay = (): void => {
    if (outline !== null) return
    const style = (element: HTMLElement, css: string): void => { element.style.cssText = css }
    outline = document.createElement('div')
    style(outline, [
      'position:fixed', 'z-index:2147483646', 'pointer-events:none', 'display:none',
      'border:2px solid #4f8cff', 'background:rgba(79,140,255,0.10)',
      'border-radius:2px', 'box-sizing:border-box',
    ].join(';'))
    tooltip = document.createElement('div')
    style(tooltip, [
      'position:fixed', 'z-index:2147483647', 'pointer-events:none',
      'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:#fff', 'background:rgba(20,24,32,0.92)', 'padding:4px 8px',
      'border-radius:4px', 'max-width:60vw', 'white-space:nowrap',
      'overflow:hidden', 'text-overflow:ellipsis',
    ].join(';'))
    document.documentElement.appendChild(outline)
    document.documentElement.appendChild(tooltip)
  }

  const positionOutline = (target: HTMLElement): void => {
    if (outline === null) return
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      outline.style.display = 'none'
      return
    }
    outline.style.display = 'block'
    outline.style.left = `${rect.left + window.scrollX}px`
    outline.style.top = `${rect.top + window.scrollY}px`
    outline.style.width = `${rect.width}px`
    outline.style.height = `${rect.height}px`
  }

  const showHover = (target: HTMLElement): void => {
    ensureOverlay()
    if (outline === null || tooltip === null) return
    if (selected !== null && selected !== target) outline.style.display = 'none'
    else positionOutline(target)
    const element = elementOf(target)
    const probe = bestProbeResult(probeChain(element))
    const label = probe === null
      ? tagOf(element)
      : probe.source?.line !== undefined
        ? `${tagOf(element)} · ${probe.framework} ${probe.source.file}:${probe.source.line}`
        : probe.source !== undefined
          ? `${tagOf(element)} · ${probe.framework} ${probe.source.file}`
          : `${tagOf(element)} · ${probe.framework}`
    tooltip.textContent = label
    tooltip.style.display = 'block'
    const rect = target.getBoundingClientRect()
    tooltip.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 320)}px`
    tooltip.style.top = `${Math.max(rect.top + window.scrollY - 28, 4)}px`
  }

  const select = (target: HTMLElement | null, notify = true): void => {
    if (selected === target) return
    selected = target
    if (outline !== null) {
      if (target === null) {
        outline.style.display = 'none'
      } else {
        positionOutline(target)
      }
    }
    if (notify) {
      post({ type: 'dsh-es:select', pick: target === null ? null : buildPick(elementOf(target)) })
    }
  }

  const reportStyle = (): void => {
    let info: StyleInfo | null = null
    if (selected !== null) {
      const el = elementOf(selected)
      const rect = selected.getBoundingClientRect()
      const computed: Record<string, string> = {}
      const names = [
        'display', 'position', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'transform', 'color',
        'background-color', 'font-size', 'z-index',
      ]
      for (const name of names) {
        try { computed[name] = getComputedStyle(selected).getPropertyValue(name) } catch { /* noop */ }
      }
      info = styleInfoOf(el, {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      }, computed)
    }
    post({ type: 'dsh-es:style', info })
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!active) return
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (target === null || target === hovered) return
    hovered = target
    showHover(target)
  }

  const onSelectClick = (event: MouseEvent): void => {
    if (!active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = hovered ?? (event.target as HTMLElement | null)
    if (target === null) return
    if (target === selected) {
      // Clicking the selected element again clears it.
      select(null)
    } else {
      select(target)
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      select(null)
      exitMode()
    }
  }

  const exitMode = (): void => {
    if (!active) return
    active = false
    select(null, false)
    if (tooltip !== null) tooltip.style.display = 'none'
    document.documentElement.style.cursor = ''
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('click', onSelectClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
  }

  const setMode = (mode: boolean): void => {
    if (mode === active) {
      if (mode) hovered = null
      return
    }
    active = mode
    if (mode) {
      document.documentElement.style.cursor = 'crosshair'
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('click', onSelectClick, true)
      document.addEventListener('keydown', onKeyDown, true)
    } else {
      exitMode()
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as ParentToProbeMessage | unknown
    if (typeof data !== 'object' || data === null) return
    const record = data as Record<string, unknown>
    switch (record.type) {
      case 'dsh-es:set-mode':
        setMode(record.mode === true)
        break
      case 'dsh-es:ping':
        post({ type: 'dsh-es:hello', protocolVersion: PROTOCOL_VERSION })
        break
      case 'dsh-es:get-tree':
        post({ type: 'dsh-es:tree', nodes: [treeOf(elementOf(document.body ?? document.documentElement))] })
        break
      case 'dsh-es:get-style':
        reportStyle()
        break
      case 'dsh-es:clear-selection':
        select(null)
        break
      case 'dsh-es:select-path': {
        const path = Array.isArray(record.path) ? record.path.filter((item): item is number => typeof item === 'number') : []
        const el = elementAtPath(elementOf(document.body ?? document.documentElement), path)
        if (el === null) break
        const element = el as unknown as HTMLElement
        element.scrollIntoView({ block: 'center', inline: 'center' })
        select(element)
        reportStyle()
        break
      }
      case 'dsh-es:apply-style': {
        if (selected === null) break
        const styles = (record.styles ?? {}) as Partial<StylePatch>
        const css = stylePatchCss(styles)
        if (css !== '') selected.style.cssText = selected.style.cssText === ''
          ? css
          : `${selected.style.cssText.replace(/;\s*$/, '')}; ${css}`
        positionOutline(selected)
        reportStyle()
        break
      }
    }
  })

  // Announce readiness to the parent.
  post({ type: 'dsh-es:hello', protocolVersion: PROTOCOL_VERSION })
}
