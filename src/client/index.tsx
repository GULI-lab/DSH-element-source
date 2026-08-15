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
import { Icon } from './icons.tsx'

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

/** The floating launcher + panel, registered in shell.overlay. */
function Launcher(props: { ctx: Context }): React.ReactElement {
  const { ctx } = props
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<SessionScope | undefined>(() => readSessionScope(ctx))

  useEffect(() => subscribeSessions(ctx, () => setScope(readSessionScope(ctx))), [ctx])

  const dismiss = useCallback((event: KeyboardEvent): void => {
    if (event.key === 'Escape') setOpen(false)
  }, [])
  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [open, dismiss])

  return (
    <>
      {/* Launcher FAB */}
      <button
        type="button"
        title="本地预览 · dsh-element-source"
        aria-label="本地预览"
        onClick={() => setOpen(previous => !previous)}
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 2147483001,
          width: 42, height: 42, borderRadius: '50%', cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l1, #3a3f4b)',
          background: 'var(--dsw-alias-bg-overlay, #1c1e26)',
          color: open ? 'var(--dsw-alias-brand-primary, #4f8cff)' : 'inherit',
          boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
      >
        <Icon name="crosshair" size={20} />
      </button>

      {/* Preview panel */}
      {open && (
        <div
          style={{
            position: 'fixed', right: 16, bottom: 74, zIndex: 2147483000,
            width: 620, maxWidth: 'calc(100vw - 32px)',
            height: 'min(72vh, 680px)',
            borderRadius: 12, overflow: 'hidden',
            border: '1px solid var(--dsw-alias-border-l1, #3a3f4b)',
            background: 'var(--dsw-alias-bg-overlay, #1c1e26)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <PreviewPanel key={scope?.sessionId ?? 'none'} ctx={ctx} sessionId={scope?.sessionId} cwd={scope?.cwd} />
        </div>
      )}
    </>
  )
}

/**
 * Client plugin body. Prefers the better-sidebar tab when the sidebar is
 * installed; falls back to the standalone overlay launcher otherwise.
 * @param ctx - the client cordis context (slots, sessions).
 */
export function apply(ctx: Context): void {
  const betterSidebar = (ctx as unknown as { get?(name: string): unknown }).get?.('betterSidebar') as BetterSidebarService | undefined
  if (betterSidebar !== undefined) {
    ctx.effect(() => betterSidebar.registerTab({
      id: OVERLAY_ID,
      title: () => (document.documentElement.lang.toLowerCase().startsWith('zh') ? '本地预览' : 'Local preview'),
      icon: (size: number) => React.createElement(Icon, { name: 'crosshair', size: Math.round(size * 0.72) }),
      order: 60,
      single: true,
      component: PreviewTab,
    }), 'dsh-element-source: better-sidebar tab')
    return
  }
  const slots = (ctx as unknown as {
    slots?: {
      inject(key: string, callback: () => () => void): () => void
      register(options: { name: string; id: string; order?: number }, component: unknown): () => void
    }
  }).slots
  if (slots === undefined) return
  ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: OVERLAY_ID, order: 100 },
    () => React.createElement(Launcher, { ctx }),
  )), 'dsh-element-source: overlay launcher')
}
