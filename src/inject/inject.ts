/**
 * dsh-element-source page probe (built to lib/inject.js). Load it in your dev
 * page — one <script> tag, or the bundled Vite plugin injects it for you:
 *
 *   <script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>
 *
 * The script idles until the DSH page (the parent window) sends a
 * `dsh-es:set-mode` message. While select mode is on it draws a dashed hover
 * preview; CLICKING LOCKS A PERSISTENT solid outline that stays until the
 * user clicks another element, clicks the same element again, or presses Esc.
 * Every lock posts `dsh-es:select` with the element's framework metadata back
 * to the parent via postMessage — which works even from a sandboxed iframe
 * (cross-origin postMessage needs no same-origin privileges).
 *
 * This entry has no exports: it is a plain side-effecting script.
 */
import {
  bestProbeResult,
  describeElement,
  probeChain,
  tagOf,
  type ProbeElement,
} from './probes.ts'
import { PROTOCOL_VERSION, type ElementPick, type ParentToProbeMessage, type ProbeToParentMessage } from '../protocol.ts'

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

  /** Select-mode state and DOM handles. */
  let active = false
  let selected: HTMLElement | null = null
  let outline: HTMLElement | null = null
  let preview: HTMLElement | null = null
  let tooltip: HTMLElement | null = null
  let hovered: HTMLElement | null = null

  const makeBox = (solid: boolean): HTMLElement => {
    const box = document.createElement('div')
    box.style.cssText = [
      'position:fixed', 'z-index:2147483646', 'pointer-events:none', 'display:none',
      'box-sizing:border-box', 'border-radius:2px',
      solid
        ? 'border:2px solid #4f8cff;background:rgba(79,140,255,0.12)'
        : 'border:1px dashed rgba(79,140,255,0.8)',
    ].join(';')
    return box
  }

  const ensureOverlay = (): void => {
    if (outline !== null) return
    outline = makeBox(true)
    preview = makeBox(false)
    tooltip = document.createElement('div')
    tooltip.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'pointer-events:none',
      'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:#fff', 'background:rgba(20,24,32,0.92)', 'padding:4px 8px',
      'border-radius:4px', 'max-width:60vw', 'white-space:nowrap',
      'overflow:hidden', 'text-overflow:ellipsis', 'display:none',
    ].join(';')
    document.documentElement.appendChild(outline)
    document.documentElement.appendChild(preview)
    document.documentElement.appendChild(tooltip)
  }

  const positionBox = (box: HTMLElement, target: HTMLElement): void => {
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      box.style.display = 'none'
      return
    }
    box.style.display = 'block'
    box.style.left = `${rect.left + window.scrollX}px`
    box.style.top = `${rect.top + window.scrollY}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
  }

  const tooltipLabel = (el: ProbeElement): string => {
    const probe = bestProbeResult(probeChain(el))
    if (probe === null) return tagOf(el)
    if (probe.source?.line !== undefined) return `${tagOf(el)} · ${probe.framework} ${probe.source.file}:${probe.source.line}`
    if (probe.source !== undefined) return `${tagOf(el)} · ${probe.framework} ${probe.source.file}`
    return `${tagOf(el)} · ${probe.framework}`
  }

  const showTooltip = (target: HTMLElement): void => {
    if (tooltip === null) return
    const rect = target.getBoundingClientRect()
    tooltip.textContent = tooltipLabel(elementOf(target))
    tooltip.style.display = 'block'
    tooltip.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 320)}px`
    tooltip.style.top = `${Math.max(rect.top + window.scrollY - 28, 4)}px`
  }

  /** Lock a persistent selection (or clear it with null). */
  const select = (target: HTMLElement | null): void => {
    selected = target
    if (outline !== null) {
      if (target === null) outline.style.display = 'none'
      else positionBox(outline, target)
    }
    if (preview !== null) preview.style.display = 'none'
    post({ type: 'dsh-es:select', pick: target === null ? null : buildPick(elementOf(target)) })
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!active) return
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (target === null || target === hovered) return
    hovered = target
    ensureOverlay()
    if (preview === null || outline === null || tooltip === null) return
    if (selected === null) {
      // No lock yet: dashed preview follows the hover.
      positionBox(preview, target)
      showTooltip(target)
    } else if (target !== selected) {
      // Locked: preview the hovered candidate, keep the solid box on the lock.
      positionBox(preview, target)
      showTooltip(target)
    } else {
      preview.style.display = 'none'
      showTooltip(target)
    }
  }

  const onSelectClick = (event: MouseEvent): void => {
    if (!active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = hovered ?? (event.target as HTMLElement | null)
    if (target === null) return
    if (target === selected) {
      // Clicking the locked element again clears the selection.
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
    select(null)
    if (preview !== null) preview.style.display = 'none'
    if (tooltip !== null) tooltip.style.display = 'none'
    document.documentElement.style.cursor = ''
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('click', onSelectClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    post({ type: 'dsh-es:pick-cancel' })
  }

  const setMode = (mode: boolean): void => {
    if (mode === active) {
      if (mode) hovered = null
      return
    }
    active = mode
    if (mode) {
      ensureOverlay()
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
    if (record.type === 'dsh-es:set-mode') {
      setMode(record.mode === true)
    } else if (record.type === 'dsh-es:ping') {
      post({ type: 'dsh-es:hello', protocolVersion: PROTOCOL_VERSION })
    }
  })

  // Announce readiness to the parent.
  post({ type: 'dsh-es:hello', protocolVersion: PROTOCOL_VERSION })
}
