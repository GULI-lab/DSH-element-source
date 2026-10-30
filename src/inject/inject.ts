/**
 * dsh-element-source page probe (built to lib/inject.js).
 *
 * Two delivery modes:
 *  - QUEUE mode (the DSH plugin injects it into the built-in browser's page):
 *    picks are pushed into `window.__dshEsPicks` and the plugin client drains
 *    them over the Electron `<webview>` bridge — the page needs no host origin
 *    and no network access.
 *  - DIRECT mode (a <script> tag / the Vite plugin on a page opened elsewhere):
 *    picks are POSTed to the DSH host derived from the script's own URL (or
 *    `window.__DSH_ES_ORIGIN__`).
 *
 * The probe only activates on a DEVELOPMENT page: it looks for Vite's dev
 * client, webpack's HMR runtime, or Vue / Svelte / Angular / code-inspector
 * dev metadata. A production build carries none of them, so a picker there
 * could never locate a source — showing it would mislead the user.
 *
 * While active, hovering shows a dashed preview plus a "选择元素" pill at the
 * element's LOWER-RIGHT corner (not at the page corner); clicking the pill or
 * the element locates its source and queues the pick. Press Esc to pause and
 * press Esc again to resume.
 *
 * This entry has no exports: it is a plain side-effecting script.
 */
import {
  bestProbeResult,
  describeElement,
  probeChain,
  type ProbeElement,
} from './probes.ts'
import { PROTOCOL_VERSION, type ElementPick } from '../protocol.ts'

const MARKER = '__dshElementSourceInstalled__'

// Guard: the script may be loaded twice (HMR, a template double-include). One
// live instance per page.
const win = window as unknown as Record<string, unknown>
if (win[MARKER] !== true) {
  win[MARKER] = true
  install()
}

/** The DSH host HTTP origin: the script's own source URL, or an explicit marker. */
function readOrigin(): string {
  const scriptUrl = typeof document.currentScript === 'object'
    && document.currentScript !== null
    && typeof (document.currentScript as HTMLScriptElement).src === 'string'
    ? (document.currentScript as HTMLScriptElement).src
    : ''
  const marker = typeof win.__DSH_ES_ORIGIN__ === 'string' ? win.__DSH_ES_ORIGIN__ : ''
  const candidate = marker !== '' ? marker : scriptUrl
  if (candidate === '') return ''
  try {
    return new URL(candidate).origin
  } catch {
    return ''
  }
}

/** One element's development-only metadata (any framework). */
function hasDevMarker(el: Element): boolean {
  const node = el as unknown as Record<string, unknown>
  return node.__vueParentComponent !== undefined
    || node.__vue__ !== undefined
    || node.__svelte_meta !== undefined
    || node.__ngContext__ !== undefined
    || (el as HTMLElement).getAttribute('data-insp-path') !== null
}

/** True when the page came from a development build (dev-only markers present). */
function isDevPage(): boolean {
  if (win.__DSH_ES_FORCE__ === true) return true
  const scripts = Array.from(document.scripts)
  if (scripts.some(script => (script.src ?? '').includes('/@vite/client'))) return true
  if (typeof (win as { webpackHotUpdate?: unknown }).webpackHotUpdate === 'function') return true
  if (document.documentElement !== null && hasDevMarker(document.documentElement)) return true
  // Frameworks mount asynchronously: sample what has rendered so far.
  return Array.from(document.querySelectorAll('*')).slice(0, 400).some(hasDevMarker)
}

function install(): void {
  const queueMode = win.__DSH_ES_QUEUE__ === true
  const origin = queueMode ? '' : readOrigin()
  const deliver = queueMode
    ? deliverToQueue
    : origin === ''
      ? null
      : (pick: ElementPick) => deliverDirect(`${origin}/dsh-element-source/api/pick`, pick)
  if (deliver === null) return
  // Give late-mounting frameworks (webpack-dev Vue/Svelte/Angular) a moment.
  let attempts = 0
  const activate = (): void => {
    if (isDevPage()) {
      start(deliver)
      return
    }
    attempts += 1
    if (attempts < 20) window.setTimeout(activate, 400)
  }
  activate()
}

/** Queue one pick for the plugin client (drained over the webview bridge). */
function deliverToQueue(pick: ElementPick): number {
  const bucket = Array.isArray(win.__dshEsPicks) ? win.__dshEsPicks as ElementPick[] : []
  bucket.push(pick)
  if (bucket.length > 16) bucket.splice(0, bucket.length - 16)
  win.__dshEsPicks = bucket
  return bucket.length
}

/** POST one pick to the DSH host (direct-script mode). */
function deliverDirect(endpoint: string, pick: ElementPick): number {
  try {
    void fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      keepalive: true,
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(pick),
    }).catch(() => undefined)
  } catch {
    // No host reachable: the page keeps working as an ordinary page.
  }
  return 0
}

function start(deliver: (pick: ElementPick) => number): void {
  let active = false
  let hovered: HTMLElement | null = null
  let outline: HTMLElement | null = null
  let preview: HTMLElement | null = null
  let pill: HTMLButtonElement | null = null
  /** The pill's last placed rectangle (the pointer near it freezes the hover). */
  let pillRect: { left: number; top: number; width: number; height: number } | null = null

  const buildPick = (el: ProbeElement): ElementPick => {
    const chain = probeChain(el)
    const best = bestProbeResult(chain)
    return {
      protocolVersion: PROTOCOL_VERSION,
      framework: best?.framework ?? 'generic',
      source: best?.source,
      name: best?.name,
      element: describeElement(el),
      pageUrl: window.location.href,
    }
  }

  const makeBox = (solid: boolean): HTMLElement => {
    const box = document.createElement('div')
    box.style.cssText = [
      'position:fixed', 'z-index:2147483646', 'pointer-events:none', 'display:none',
      'box-sizing:border-box', 'border-radius:2px',
      solid
        ? 'border:2px solid #4f8cff;background:rgba(79,140,255,0.10)'
        : 'border:1px dashed rgba(79,140,255,0.8)',
    ].join(';')
    return box
  }

  const ensureOverlay = (): void => {
    if (outline !== null) return
    outline = makeBox(true)
    preview = makeBox(false)
    document.documentElement.appendChild(outline)
    document.documentElement.appendChild(preview)
  }

  const positionBox = (box: HTMLElement | null, target: HTMLElement): void => {
    if (box === null) return
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

  /** The pill's add-to-chat icon (filled, the state color drives it). */
  const PILL_ICON = '<svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" style="flex:none"><path d="M955.140191 657.686057L482.322585 376.382253c-17.251919-10.262738-28.340465-2.425236-24.684192 17.409508l100.538811 543.990599c3.666506 19.828604 16.083304 22.576181 27.628244 6.077415 0 0 64.233953-92.081185 116.91478-148.294464l101.060697 150.524248c9.646708 14.33652 29.105898 18.077727 43.275619 8.336876l33.92567-23.452132c14.148231-9.760295 17.830087-29.519314 8.207939-43.884486L788.174482 736.668922c67.536162-27.991518 162.961512-51.606355 162.961512-51.606354 19.460214-4.800329 21.261233-17.116843 4.004197-27.376511z"></path><path d="M491.223303 891.487987H219.679793c-49.051159 0-88.897679-38.494733-88.897679-85.863576v-594.520435c0-47.365774 39.84652-85.924975 88.897679-85.924975v0.057305h583.463612c48.995901 0 88.843444 38.556131 88.843444 85.924975v346.19779h65.833381V211.160257c0-83.677794-69.426209-151.757333-154.681942-151.757332h-583.458495c-85.305875 0-154.672732 68.079538-154.672732 151.757332v594.519412c0 83.625606 69.366857 151.702074 154.672732 151.702074h271.542486v-65.893756z"></path></svg>'

  /** Show the pill's add-to-chat face (icon + label). */
  const showAddFace = (): void => {
    if (pill === null) return
    pill.innerHTML = `${PILL_ICON}<span>添加到对话</span>`
  }

  const ensurePill = (): void => {
    if (pill !== null) return
    pill = document.createElement('button')
    pill.type = 'button'
    pill.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'pointer-events:auto', 'cursor:pointer',
      'border:1px solid rgba(79,140,255,0.55)', 'border-radius:12px', 'padding:3px 10px',
      'font:12px/1.4 -apple-system,Segoe UI,sans-serif', 'background:rgba(20,24,32,0.9)',
      'color:#d7e3ff', 'box-shadow:0 2px 10px rgba(0,0,0,0.35)', 'display:none',
      'white-space:nowrap', 'align-items:center', 'gap:5px',
    ].join(';')
    showAddFace()
    pill.style.display = 'none'
    pill.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (hovered !== null) pick(hovered)
    })
    document.documentElement.appendChild(pill)
  }

  /**
   * Place the pill at the target's lower-right corner, OUTSIDE the element so
   * it never covers the element's content. Moving the pointer toward the pill
   * freezes the hover (see {@link nearPill}), so the pill cannot chase it.
   */
  const positionPill = (target: HTMLElement): void => {
    ensurePill()
    if (pill === null) return
    showAddFace()
    pill.style.display = 'inline-flex'
    const rect = target.getBoundingClientRect()
    const width = pill.offsetWidth > 0 ? pill.offsetWidth : 120
    const height = pill.offsetHeight > 0 ? pill.offsetHeight : 26
    const left = Math.max(4, Math.min(rect.right - width, window.innerWidth - width - 4))
    const top = Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - height - 4))
    pill.style.left = `${left}px`
    pill.style.top = `${top}px`
    pillRect = { left, top, width, height }
  }

  /** True when the pointer is on or near the pill (the pointer is heading to it). */
  const nearPill = (x: number, y: number): boolean => {
    if (pillRect === null) return false
    const pad = 10
    return x >= pillRect.left - pad && x <= pillRect.left + pillRect.width + pad
      && y >= pillRect.top - pad && y <= pillRect.top + pillRect.height + pad
  }

  const hidePill = (): void => {
    if (pill !== null) pill.style.display = 'none'
    pillRect = null
  }

  /** Locate one element: lock the outline, queue the pick, confirm on the pill. */
  const pick = (target: HTMLElement): void => {
    ensureOverlay()
    positionBox(outline, target)
    const queued = deliver(buildPick(target as unknown as ProbeElement))
    positionPill(target)
    if (pill !== null) pill.textContent = queued > 0 ? `已定位 · ${queued}` : '已定位'
    window.setTimeout(() => {
      if (pill !== null && pill.textContent !== null && pill.textContent.startsWith('已定位')) hidePill()
    }, 1200)
  }

  const ownElement = (target: EventTarget | null): boolean => {
    return pill !== null && target instanceof Node && pill.contains(target)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!active) return
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (target === null) return
    // Never let our own pill become the hover target: keep the last real
    // element so the pill keeps its anchor and stays clickable.
    if (ownElement(target)) return
    // The pointer is on its way to the pill: freeze the hover so the pill does
    // not jump to an element the pointer passes over.
    if (nearPill(event.clientX, event.clientY)) return
    if (target === hovered) return
    hovered = target
    ensureOverlay()
    positionBox(preview, target)
    positionPill(target)
  }

  /**
   * While picking, page clicks are neutralized: the page action is blocked, and
   * ONLY a click on the pill picks. Clicking an element directly never picks
   * (no accidental writes to the composer).
   */
  const onClick = (event: MouseEvent): void => {
    if (!active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (ownElement(event.target) && hovered !== null) pick(hovered)
  }

  /** No page context menu while picking (a right-click is not a pick either). */
  const onContextMenu = (event: MouseEvent): void => {
    if (!active) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setActive(false)
  }

  const setActive = (next: boolean): void => {
    active = next
    document.documentElement.dataset.dshEsActive = next ? '1' : '0'
    if (active) {
      ensureOverlay()
      document.documentElement.style.cursor = 'crosshair'
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('click', onClick, true)
      document.addEventListener('contextmenu', onContextMenu, true)
      document.addEventListener('keydown', onKeyDown, true)
    } else {
      hovered = null
      document.documentElement.style.cursor = ''
      if (preview !== null) preview.style.display = 'none'
      if (outline !== null) outline.style.display = 'none'
      hidePill()
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }

  // The DSH client's toolbar switch drives the picker. The picker starts ON so
  // the first click after opening a dev page is a pick; the switch (and Esc)
  // turns it off when the page should behave normally.
  win.__dshEsSetActive = (on: unknown): void => { setActive(on === true) }
  document.documentElement.dataset.dshEs = 'dev'
  setActive(true)
}
