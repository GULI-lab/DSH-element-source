/**
 * dsh-element-source page probe (built to lib/inject.js). Load it in your dev
 * page — one <script> tag, or the bundled Vite plugin injects it for you:
 *
 *   <script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>
 *
 * The script idles until the DSH page (the parent window) sends a
 * `dsh-es:set-mode` message. While pick mode is on it draws a hover outline
 * and, on click, posts the element's framework metadata back to the parent
 * via postMessage — which works even from the sandboxed sidebar iframe
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

  /** Mode state and DOM handles for the current pick session. */
  let active = false
  let outline: HTMLElement | null = null
  let tooltip: HTMLElement | null = null
  let hovered: HTMLElement | null = null

  const exitMode = (notify: 'cancel' | 'done'): void => {
    if (!active) return
    active = false
    if (outline !== null) outline.remove()
    if (tooltip !== null) tooltip.remove()
    outline = null
    tooltip = null
    hovered = null
    document.documentElement.style.cursor = ''
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('click', onPickClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    post(notify === 'cancel' ? { type: 'dsh-es:pick-cancel' } : { type: 'dsh-es:pick-done' })
  }

  const ensureOverlay = (): void => {
    if (outline !== null) return
    const style = (element: HTMLElement, css: string): void => { element.style.cssText = css }
    outline = document.createElement('div')
    style(outline, [
      'position:fixed', 'z-index:2147483646', 'pointer-events:none', 'display:none',
      'border:2px solid #4f8cff', 'background:rgba(79,140,255,0.12)',
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

  const showHighlight = (target: HTMLElement): void => {
    ensureOverlay()
    if (outline === null || tooltip === null) return
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      outline.style.display = 'none'
      tooltip.style.display = 'none'
      return
    }
    outline.style.display = 'block'
    outline.style.left = `${rect.left + window.scrollX}px`
    outline.style.top = `${rect.top + window.scrollY}px`
    outline.style.width = `${rect.width}px`
    outline.style.height = `${rect.height}px`
    const element = target as unknown as ProbeElement
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
    tooltip.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 320)}px`
    tooltip.style.top = `${Math.max(rect.top + window.scrollY - 28, 4)}px`
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!active) return
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (target === null || target === hovered) return
    hovered = target
    showHighlight(target)
  }

  const onPickClick = (event: MouseEvent): void => {
    if (!active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = hovered ?? (event.target as HTMLElement | null)
    if (target === null) {
      exitMode('cancel')
      return
    }
    const element = target as unknown as ProbeElement
    const chain = probeChain(element)
    const best = bestProbeResult(chain)
    const pick: ElementPick = {
      protocolVersion: PROTOCOL_VERSION,
      framework: best?.framework ?? 'generic',
      source: best?.source,
      name: best?.name,
      element: describeElement(element),
      pageUrl: window.location.href,
    }
    post({ type: 'dsh-es:pick', pick })
    exitMode('done')
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') exitMode('cancel')
  }

  const setMode = (mode: boolean): void => {
    if (mode === active) {
      // Re-arm highlight state on re-entry.
      if (mode) hovered = null
      return
    }
    active = mode
    if (mode) {
      document.documentElement.style.cursor = 'crosshair'
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('click', onPickClick, true)
      document.addEventListener('keydown', onKeyDown, true)
    } else {
      exitMode('done')
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
