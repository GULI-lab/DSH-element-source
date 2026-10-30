/**
 * Client half of dsh-element-source.
 *
 * The plugin owns no preview UI of its own: the DSH built-in browser is the
 * surface. Here we
 *  - inject the page probe into the built-in browser's Electron `<webview>`
 *    pages (queue mode: the probe stashes picks in `window.__dshEsPicks`),
 *  - drain those picks and hand them to the host,
 *  - append a picker switch as the LAST button of the browser's own toolbar
 *    (only for a development page) so it reads as a native toolbar tool, and
 *  - poll the host for resolved locations and fill the CURRENT session's
 *    composer draft (never sends it).
 *
 * All host calls are same-origin relative URLs: the desktop app proxies
 * `dsh-app://app/*` to its own web server (with authentication), and the web
 * GUI is same-origin by definition — no port or origin is ever needed.
 */
import React, { useEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { buildReference, insertLocatedSource } from './draft.ts'
import type { ElementPick, PendingResult } from '../protocol.ts'

/** Services required before mounting (the slot registry + client sessions). */
export const inject = ['slots', 'sessions']

/** The frame-wide overlay entry hosting the invisible machinery. */
const OVERLAY_ID = 'dsh-element-source.ui'

/** Interval of one drain + pending poll. */
const POLL_MS = 300

/** Marker attribute of the toolbar switch we append. */
const SWITCH_ATTR = 'data-dsh-element-source-switch'

/** The switch's own stylesheet (injected once, matches the toolbar tools). */
const SWITCH_STYLE_ID = 'dsh-element-source-switch-style'

/** The session slice the poller needs. */
interface SessionScope {
  sessionId: string
  cwd?: string
}

/** Structural mirror of the client sessions list feed. */
interface SessionListLike {
  current?: string
  byId?: Record<string, { id?: string; cwd?: string; retainedBy?: { mainView?: number } }>
}

interface SessionsLike {
  list?: { getSnapshot?(): SessionListLike }
}

/** Structural mirror of an Electron `<webview>` element. */
interface WebviewLike extends HTMLElement {
  src?: string
  getURL?(): string
  executeJavaScript?(code: string, userGesture?: boolean): Promise<unknown>
}

/** One drain result: the queued picks plus the probe's picker state. */
interface DrainResult {
  picks: ElementPick[]
  /** True when the page is a development page (the probe activated). */
  dev: boolean
  /** True when the picker is enabled on that page. */
  enabled: boolean
}

/** Read the current session's id + cwd (undefined before a session is retained). */
function readSessionScope(ctx: Context): SessionScope | undefined {
  const sessions = (ctx as unknown as { sessions?: SessionsLike }).sessions
  const snap = sessions?.list?.getSnapshot?.()
  if (snap === undefined) return undefined
  const byId = snap.byId ?? {}
  const currentId = snap.current !== undefined && snap.current !== ''
    ? snap.current
    : Object.values(byId).find(entry => (entry.retainedBy?.mainView ?? 0) > 0)?.id
  if (currentId === undefined) return undefined
  return { sessionId: currentId, cwd: byId[currentId]?.cwd }
}

/** The probe source, fetched once per GUI lifetime. */
let probeSource: Promise<string | undefined> | undefined

function loadProbeSource(): Promise<string | undefined> {
  probeSource ??= (async () => {
    try {
      const response = await fetch('/dsh-element-source/inject.js', { cache: 'no-store' })
      return response.ok ? await response.text() : undefined
    } catch {
      return undefined
    }
  })()
  return probeSource
}

/** Inject the probe (queue mode) into one Electron `<webview>` page. */
async function injectProbe(webview: WebviewLike): Promise<boolean> {
  const execute = webview.executeJavaScript
  if (typeof execute !== 'function') return false
  const source = await loadProbeSource()
  if (source === undefined) return false
  try {
    await execute.call(webview, `window.__DSH_ES_QUEUE__ = true;\n${source}`, true)
    return true
  } catch {
    return false
  }
}

/** Read and clear one webview's queued picks plus the picker state. */
async function drainWebview(webview: WebviewLike): Promise<DrainResult | undefined> {
  const execute = webview.executeJavaScript
  if (typeof execute !== 'function') return undefined
  try {
    const raw = await execute.call(webview, '(function(){var p=window.__dshEsPicks||[];window.__dshEsPicks=[];var d=document.documentElement.dataset||{};return JSON.stringify({p:p,dev:d.dshEs||"",on:d.dshEsActive||""})})()', true)
    if (typeof raw !== 'string') return undefined
    const parsed = JSON.parse(raw) as { p?: unknown; dev?: unknown; on?: unknown }
    const picks = Array.isArray(parsed.p)
      ? parsed.p.filter((item): item is ElementPick => typeof item === 'object' && item !== null)
      : []
    return { picks, dev: parsed.dev === 'dev', enabled: parsed.on === '1' }
  } catch {
    return undefined
  }
}

/** Watch the built-in browser's webviews and inject the probe on every load. */
function useWebviewProbe(): void {
  useEffect(() => {
    const hooked = new WeakSet<WebviewLike>()
    const hook = (webview: WebviewLike): void => {
      if (hooked.has(webview)) return
      hooked.add(webview)
      // Re-inject on every navigation: a page reload creates a fresh page that
      // needs a fresh probe (the probe's own guard keeps it single-instance).
      const inject = (): void => {
        const url = webview.getURL?.() ?? webview.src ?? ''
        if (url === '' || url === 'about:blank') return
        void injectProbe(webview)
      }
      webview.addEventListener('dom-ready', inject)
      webview.addEventListener('did-navigate', inject)
      webview.addEventListener('did-navigate-in-page', inject)
      inject()
    }
    const scan = (): void => {
      for (const webview of Array.from(document.querySelectorAll('webview')) as WebviewLike[]) hook(webview)
    }
    scan()
    // Tabs created later mount new webview elements.
    const observer = new MutationObserver(scan)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
}

/** Same-origin POST of one queued pick to the host. */
async function tellHost(pick: ElementPick): Promise<void> {
  try {
    await fetch('/dsh-element-source/api/pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pick),
    })
  } catch {
    // Host unreachable: the pick is already drained; the user can re-click.
  }
}

/** The webview's own toolbar element (the row holding its address input). */
function toolbarOf(webview: WebviewLike): HTMLElement | undefined {
  const rect = webview.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return undefined
  const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
  const address = inputs.find((input) => {
    const box = input.getBoundingClientRect()
    return box.width > 120
      && box.bottom <= rect.top + 6
      && box.top >= rect.top - 48
      && box.left >= rect.left - 4
  })
  // address input -> address box -> toolbar row
  return address?.parentElement?.parentElement ?? undefined
}

/** One-time stylesheet for the toolbar switch (hover behaves like a tool). */
function ensureSwitchStyle(): void {
  if (document.getElementById(SWITCH_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = SWITCH_STYLE_ID
  style.textContent = [
    `[${SWITCH_ATTR}]{width:28px;height:28px;padding:0;border:0;border-radius:6px;`,
    '  background:var(--dsh-es-switch-bg,transparent);color:var(--dsh-es-switch-fg,inherit);',
    '  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;',
    '  transition:background 120ms ease,color 120ms ease}',
    `[${SWITCH_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.12))}`,
    `[${SWITCH_ATTR}][data-on="1"]:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 26%,transparent)}`,
  ].join('\n')
  document.head.appendChild(style)
}

/** The user's select-element icon (1024 grid, filled): the state color drives it. */
const SWITCH_ICON = '<svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M955.140191 657.686057L482.322585 376.382253c-17.251919-10.262738-28.340465-2.425236-24.684192 17.409508l100.538811 543.990599c3.666506 19.828604 16.083304 22.576181 27.628244 6.077415 0 0 64.233953-92.081185 116.91478-148.294464l101.060697 150.524248c9.646708 14.33652 29.105898 18.077727 43.275619 8.336876l33.92567-23.452132c14.148231-9.760295 17.830087-29.519314 8.207939-43.884486L788.174482 736.668922c67.536162-27.991518 162.961512-51.606355 162.961512-51.606354 19.460214-4.800329 21.261233-17.116843 4.004197-27.376511z"></path><path d="M491.223303 891.487987H219.679793c-49.051159 0-88.897679-38.494733-88.897679-85.863576v-594.520435c0-47.365774 39.84652-85.924975 88.897679-85.924975v0.057305h583.463612c48.995901 0 88.843444 38.556131 88.843444 85.924975v346.19779h65.833381V211.160257c0-83.677794-69.426209-151.757333-154.681942-151.757332h-583.458495c-85.305875 0-154.672732 68.079538-154.672732 151.757332v594.519412c0 83.625606 69.366857 151.702074 154.672732 151.702074h271.542486v-65.893756z"></path></svg>'

/** The live toggle handler per switch button (refreshed every cycle). */
const switchHandlers = new WeakMap<HTMLButtonElement, () => void>()

/** Append (or refresh) the switch as the toolbar's LAST child. */
function ensureSwitch(toolbar: HTMLElement, enabled: boolean, onToggle: () => void): void {
  ensureSwitchStyle()
  let button = toolbar.querySelector(`[${SWITCH_ATTR}]`) as HTMLButtonElement | null
  if (button === null) {
    button = document.createElement('button')
    button.type = 'button'
    button.setAttribute(SWITCH_ATTR, '')
    button.innerHTML = SWITCH_ICON
    button.style.flex = 'none'
    const created = button
    // The listener is bound once but always reads the cycle's latest handler:
    // a captured closure would keep sending the first state's command.
    created.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      switchHandlers.get(created)?.()
    })
  }
  switchHandlers.set(button, onToggle)
  // Keep it the last toolbar item even after a toolbar re-render.
  if (toolbar.lastElementChild !== button) toolbar.appendChild(button)
  button.dataset.on = enabled ? '1' : '0'
  button.title = enabled ? '关闭元素定位（Esc）' : '开启元素定位'
  button.setAttribute('aria-label', button.title)
  button.style.setProperty('--dsh-es-switch-fg', enabled
    ? 'var(--dsw-alias-brand-primary, #4f8cff)'
    : 'var(--dsw-alias-label-secondary, #c0c4cc)')
  button.style.setProperty('--dsh-es-switch-bg', enabled
    ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 16%, transparent)'
    : 'transparent')
}

/** Locations inserted as reference chips, keyed by the chip's display label. */
const locatedChips = new Map<string, { relative: string; line?: number }>()

/** Encode one address path segment (colons stay literal, matching the @ menu). */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** The `dsh-resource://file/session/<id>/<path>` address the preview opens. */
function fileAddress(sessionId: string, relative: string): string {
  const path = relative.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${path.split('/').map(encodeSegment).join('/')}`
}

/** Open the located file preview at its line (the sidebar's document preview). */
function openLocatedSource(ctx: Context, sessionId: string, located: { relative: string, line?: number }): void {
  const sidebar = (ctx as unknown as {
    get?(name: string): unknown
    reflect?: { get(name: string): unknown }
  })
  const service = (sidebar.get?.('sidebarRight') ?? sidebar.reflect?.get('sidebarRight')) as {
    openResource?(address: string, options?: { params?: { line?: number } }): void
  } | undefined
  if (typeof service?.openResource !== 'function') return
  const address = fileAddress(sessionId, located.relative)
  service.openResource(address, located.line !== undefined ? { params: { line: located.line } } : undefined)
}

/** Remove the switch from a toolbar (a page that is not a development page). */
function removeSwitch(toolbar: HTMLElement): void {
  const button = toolbar.querySelector(`[${SWITCH_ATTR}]`)
  if (button !== null) button.remove()
}

/** One drain + poll cycle: probe picks to the host, resolved picks to the draft. */
async function cycle(
  ctx: Context,
  state: { lastSeq: number },
  webviewRef: { current: WebviewLike | null },
): Promise<void> {
  // 1. Drain picks and the picker state from every injected webview.
  for (const webview of Array.from(document.querySelectorAll('webview')) as WebviewLike[]) {
    const drained = await drainWebview(webview)
    if (drained === undefined) continue
    // The switch exists only while the page is a development page: a plain page
    // (after navigating away) must not show a misleading picker control.
    const toolbar = toolbarOf(webview)
    if (toolbar !== undefined && drained.dev) {
      webviewRef.current = webview
      ensureSwitch(toolbar, drained.enabled, () => {
        const current = webviewRef.current
        const execute = current?.executeJavaScript
        if (execute === undefined) return
        void execute.call(current, `window.__dshEsSetActive(${drained.enabled ? 'false' : 'true'})`, true)
      })
    } else if (toolbar !== undefined) {
      removeSwitch(toolbar)
    }
    if (drained.picks.length > 0) {
      for (const pick of drained.picks) await tellHost(pick)
    }
  }

  // 2. Poll resolved locations and fill the composer draft.
  const scope = readSessionScope(ctx)
  if (scope === undefined) return
  const params = new URLSearchParams({ after: String(state.lastSeq), sessionId: scope.sessionId })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  const response = await fetch(`/dsh-element-source/api/pending?${params.toString()}`)
  if (!response.ok) return
  const body = (await response.json()) as {
    ok?: boolean
    value?: { sequence?: number; results?: PendingResult[] }
  }
  const value = body.value
  if (body.ok !== true || value === undefined) return
  state.lastSeq = typeof value.sequence === 'number' ? value.sequence : state.lastSeq
  for (const result of value.results ?? []) {
    if (result.ok === true && result.relative !== undefined) {
      if (insertLocatedSource(ctx, scope.sessionId, result.relative, result.line)) {
        locatedChips.set(buildReference(result.relative, result.line).label, { relative: result.relative, line: result.line })
      }
    }
  }
}

/**
 * The invisible overlay entry: webview probe injection, the toolbar switch, and
 * the drain/poll loop.
 * @param props - the client context.
 */
function ElementSourceHooks(props: { ctx: Context }): React.ReactElement {
  const { ctx } = props
  useWebviewProbe()
  const webviewRef = useRef<WebviewLike | null>(null)
  useEffect(() => {
    const state = { lastSeq: 0 }
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        await cycle(ctx, state, webviewRef)
      } catch {
        // Host unreachable (carrier handoff, restart): retry next tick.
      } finally {
        busy = false
      }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [ctx])
  // A click on one of our composer chips opens the preview at the located line
  // instead of the default top-of-file open.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      const chip = target?.closest?.('[data-composer-chip="reference"]') as HTMLElement | null
      if (chip === null) return
      const located = locatedChips.get((chip.textContent ?? '').trim())
      if (located === undefined) return
      const scope = readSessionScope(ctx)
      if (scope === undefined) return
      event.preventDefault()
      event.stopImmediatePropagation()
      openLocatedSource(ctx, scope.sessionId, located)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [ctx])
  return React.createElement(React.Fragment)
}

/**
 * Client plugin entry: mount the invisible hooks entry in the frame overlay.
 * @param ctx - the client cordis context (slots, sessions).
 */
export function apply(ctx: Context): void {
  const slots = (ctx as unknown as {
    slots?: {
      inject(key: string, callback: () => () => void): () => void
      register(options: { name: string; id: string; order?: number }, component: unknown): () => void
    }
  }).slots
  if (slots === undefined) return
  ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: OVERLAY_ID, order: 100 },
    () => React.createElement(ElementSourceHooks, { ctx }),
  )), 'dsh-element-source: picker hooks')
}
