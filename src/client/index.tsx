/**
 * Client half of dsh-element-source. Dual-mode, compatible with and without
 * dsh-better-sidebar:
 *  - better-sidebar installed → the preview mounts as its "Local preview" tab
 *    (preferred entry; the floating launcher is suppressed, so the two UIs
 *    never overlap);
 *  - otherwise → a frame-wide `shell.overlay` entry shows a floating
 *    crosshair launcher (bottom-right) toggling the preview panel, bound to
 *    the CURRENT session from the client sessions service.
 * Routes (/dsh-element-source/*), postMessage namespaces (dsh-es:*) and slots
 * (shell.overlay) are disjoint from better-sidebar's, so the two plugins
 * coexist without functional conflict.
 */
import React, { useCallback, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls dsh-better-sidebar's Context augmentation and types.
import type {} from 'dsh-better-sidebar'
import type { BetterSidebarService } from 'dsh-better-sidebar'
import { PreviewPanel } from './PreviewPanel.tsx'
import { PreviewTab } from './PreviewTab.tsx'
import { Icon, IconButton } from './icons.tsx'

/** Services required before mounting (client runtime sessions + the slot registry). */
export const inject = ['slots', 'sessions']

const OVERLAY_ID = 'dsh-element-source'

/** The session slice the panel needs. */
interface SessionScope {
  sessionId: string
  cwd?: string
}

/** Structural mirror of the client sessions list feed. */
interface SessionListLike {
  current?: string
  byId?: Record<string, { id?: string; cwd?: string }>
}

interface SessionsLike {
  list?: {
    getSnapshot?(): SessionListLike
    subscribe?(fn: () => void): () => void
  }
}

/** Read the current session's id + cwd (undefined before any session exists). */
function readSessionScope(ctx: Context): SessionScope | undefined {
  const sessions = (ctx as unknown as { sessions?: SessionsLike }).sessions
  const snap = sessions?.list?.getSnapshot?.()
  if (snap === undefined || snap.current === undefined) return undefined
  const entry = snap.byId?.[snap.current]
  if (entry === undefined) return undefined
  return { sessionId: snap.current, cwd: entry.cwd }
}

/** Subscribe to session changes (returns the disposer). */
function subscribeSessions(ctx: Context, fn: () => void): () => void {
  const sessions = (ctx as unknown as { sessions?: SessionsLike }).sessions
  return sessions?.list?.subscribe?.(fn) ?? (() => {})
}

/** localStorage keys for the sidebar size/open state. */
const LS_WIDTH = 'dsh-element-source.sidebarWidth'
const LS_OPEN = 'dsh-element-source.sidebarOpen'

const MIN_WIDTH = 160

function clampWidth(value: number): number {
  const viewport = typeof window === 'undefined' ? 640 : window.innerWidth
  return Math.min(Math.max(Math.round(value), MIN_WIDTH), Math.round(viewport * 0.92))
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function readOpen(): boolean {
  try {
    const raw = localStorage.getItem(LS_OPEN)
    return raw === null ? true : raw === '1'
  } catch {
    return true
  }
}

function writeOpen(open: boolean): void {
  try { localStorage.setItem(LS_OPEN, open ? '1' : '0') } catch { /* storage unavailable */ }
}

/** The DSH app root (better-sidebar squeezes it with margin-right the same way). */
function appRoot(): HTMLElement | null {
  return document.getElementById('root')
}

/**
 * Squeeze the DSH app so the chat reflows instead of being covered: set
 * `margin-right` on `#root` equal to the sidebar width (better-sidebar's
 * layout.css does exactly this). Width 0/undefined clears the squeeze.
 */
function setAppSqueeze(widthPx: number | undefined): void {
  const root = appRoot()
  if (root === null) return
  if (widthPx === undefined) {
    root.style.marginRight = ''
    root.style.transition = ''
    return
  }
  root.style.marginRight = `${widthPx}px`
  root.style.transition = 'margin-right 150ms ease'
}

/** The standalone right sidebar (registered in shell.overlay; open by default
 *  like a workbench sidebar, collapsible to a slim edge strip, resizable by
 *  dragging its left edge). Colors follow the DSH theme tokens so the panel
 *  matches the GUI in both light and dark themes. */
function Launcher(props: { ctx: Context }): React.ReactElement {
  const { ctx } = props
  const [open, setOpenState] = useState(readOpen)
  const [width, setWidth] = useState(() => clampWidth(readNumber(LS_WIDTH, 320)))
  const [scope, setScope] = useState<SessionScope | undefined>(() => readSessionScope(ctx))

  const setOpen = useCallback((next: boolean): void => {
    setOpenState(next)
    writeOpen(next)
  }, [])

  useEffect(() => { try { localStorage.setItem(LS_WIDTH, String(width)) } catch { /* storage unavailable */ } }, [width])
  useEffect(() => subscribeSessions(ctx, () => setScope(readSessionScope(ctx))), [ctx])

  // Reflow the chat: squeeze #root by the sidebar width while open (like
  // better-sidebar); clear when collapsed, and on unmount. No cleanup on width
  // change so committing a drag never flickers the chat.
  useEffect(() => {
    if (open) setAppSqueeze(width)
    else setAppSqueeze(undefined)
  }, [open, width])
  useEffect(() => () => { setAppSqueeze(undefined) }, [])

  const dismiss = useCallback((event: KeyboardEvent): void => {
    if (event.key === 'Escape') setOpen(false)
  }, [setOpen])
  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [open, dismiss])

  // Drag-to-resize: dragging the left edge right shrinks, left grows. The
  // live value is applied straight to the DOM (container width + #root margin,
  // transition off) so dragging never re-renders React per pixel; the final
  // width is committed to state on pointer up.
  const containerRef = React.useRef<HTMLDivElement>(null)
  const dragState = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const dragWidth = React.useRef<number>(width)

  const applyLiveWidth = useCallback((next: number): void => {
    dragWidth.current = next
    if (containerRef.current !== null) containerRef.current.style.width = `${next}px`
    const root = appRoot()
    if (root !== null) {
      root.style.marginRight = `${next}px`
      root.style.transition = 'none'
    }
  }, [])

  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    dragState.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [width])
  const onDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const state = dragState.current
    if (state === null) return
    applyLiveWidth(clampWidth(state.startWidth + (state.startX - event.clientX)))
  }, [applyLiveWidth])
  const endDrag = useCallback((): void => {
    dragState.current = null
    setWidth(dragWidth.current)
  }, [])

  const fill = 'var(--dsw-specific-sidebar-fill, #1b1b22)'
  const border = 'var(--dsw-alias-border-l1, #3a3f4b)'
  const accent = 'var(--dsw-alias-brand-primary, #4f8cff)'
  const title = document.documentElement.lang.toLowerCase().startsWith('zh') ? '本地预览' : 'Local preview'

  if (!open) {
    // Collapsed edge strip (still a sidebar, not a floating window), right
    // below the top bar.
    return (
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', top: 80, right: 0, zIndex: 2147483000, pointerEvents: 'auto',
          width: 30, height: 140, padding: 0, gap: 6,
          borderTopLeftRadius: 10, borderBottomLeftRadius: 10,
          border: `1px solid ${border}`, borderRight: 'none',
          background: fill, color: accent, cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          boxShadow: '-2px 0 10px rgba(0,0,0,0.25)',
        }}
      >
        <Icon name="browser" size={16} />
        <span style={{ writingMode: 'vertical-rl', fontSize: 11, letterSpacing: 2, opacity: 0.9 }}>{title}</span>
      </button>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2147483000,
        width, pointerEvents: 'auto',
        display: 'flex', flexDirection: 'column',
        background: fill, color: 'var(--dsw-alias-label-primary, inherit)',
        borderLeft: `1px solid ${border}`,
      }}
    >
      {/* Drag handle */}
      <div
        title="拖动调整宽度"
        onPointerDown={startDrag}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'absolute', top: 0, bottom: 0, left: -3, width: 6,
          cursor: 'ew-resize', pointerEvents: 'auto', zIndex: 1,
        }}
      />
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderBottom: `1px solid ${border}`,
        fontSize: 12, fontWeight: 600, flexShrink: 0,
      }}>
        <span style={{ color: accent, display: 'inline-flex' }}><Icon name="browser" size={14} /></span>
        <span>{title}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="close" title="收起" onClick={() => setOpen(false)} />
      </div>
      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <PreviewPanel key={scope?.sessionId ?? 'none'} ctx={ctx} sessionId={scope?.sessionId} cwd={scope?.cwd} />
      </div>
    </div>
  )
}

/** Structural read of the (optional) better-sidebar service. */
function betterSidebarOf(ctx: Context): BetterSidebarService | undefined {
  return (ctx as unknown as { get?(name: string): unknown }).get?.('betterSidebar') as BetterSidebarService | undefined
}

/** Register the "Local preview" tab in better-sidebar; false when the service
 *  is not (yet) provided. */
function registerSidebarTab(ctx: Context): boolean {
  const betterSidebar = betterSidebarOf(ctx)
  if (betterSidebar === undefined) return false
  ctx.effect(() => betterSidebar.registerTab({
    id: OVERLAY_ID,
    title: () => (document.documentElement.lang.toLowerCase().startsWith('zh') ? '本地预览' : 'Local preview'),
    icon: (size: number) => React.createElement(Icon, { name: 'browser', size: Math.round(size * 0.72) }),
    order: 60,
    single: true,
    component: PreviewTab,
  }), 'dsh-element-source: better-sidebar tab')
  return true
}

/**
 * Client plugin body. Prefers the better-sidebar tab when the sidebar is
 * installed; falls back to the standalone right sidebar otherwise. The choice
 * is REACTIVE: better-sidebar may provide its service after this plugin
 * activates, so the tab registration retries until it appears and the
 * standalone sidebar suppresses itself while better-sidebar exists (the two
 * UIs never overlap regardless of boot order).
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
  // Standalone right sidebar, gated on better-sidebar absence.
  ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: OVERLAY_ID, order: 100 },
    () => React.createElement(StandaloneGate, { ctx }),
  )), 'dsh-element-source: overlay launcher')
  // Tab registration: immediate, then retry until better-sidebar appears.
  if (registerSidebarTab(ctx)) return
  let timer = 0
  ctx.effect(() => {
    const attempt = (): void => {
      if (registerSidebarTab(ctx)) return
      if (timer < 25) timer = window.setTimeout(attempt, 400)
    }
    attempt()
    return () => window.clearTimeout(timer)
  }, 'dsh-element-source: better-sidebar tab retry')
}

/** Renders the standalone sidebar only while better-sidebar is absent, so the
 *  two UIs never overlap regardless of service-provide timing. */
function StandaloneGate(props: { ctx: Context }): React.ReactElement {
  const { ctx } = props
  const [hasBetter, setHasBetter] = useState(() => betterSidebarOf(ctx) !== undefined)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setHasBetter(betterSidebarOf(ctx) !== undefined)
    }, 600)
    return () => window.clearInterval(timer)
  }, [ctx])
  if (hasBetter) return React.createElement(React.Fragment)
  return React.createElement(Launcher, { ctx })
}
