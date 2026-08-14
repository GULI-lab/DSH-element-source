/**
 * Client half of dsh-element-source: registers the "Local preview" tab in the
 * dsh-better-sidebar sidebar. The tab embeds a sandboxed iframe that CAN open
 * loopback URLs (localhost dev servers) and hosts the pick-mode toggle; the
 * page probe (inject.js) posts picked elements back over postMessage.
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls dsh-better-sidebar's Context augmentation (ctx.betterSidebar)
// and the TabDescriptor type. Erased at build time.
import type {} from 'dsh-better-sidebar'
import { PreviewTab } from './PreviewTab.tsx'

/** Services required before mounting (provided by dsh-better-sidebar's client half). */
export const inject = ['betterSidebar']

const TAB_ID = 'dsh-element-source'

/** The plugin's tab icon: a small crosshair glyph. */
function tabIcon(size: number): React.ReactNode {
  return React.createElement('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      fontSize: size * 0.72,
      lineHeight: 1,
      fontWeight: 600,
    },
  }, '⌖')
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (betterSidebar is a declared injection).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: TAB_ID,
    title: () => (document.documentElement.lang.toLowerCase().startsWith('zh') ? '本地预览' : 'Local preview'),
    icon: tabIcon,
    order: 60,
    single: true,
    component: PreviewTab,
  }), 'dsh-element-source: register preview tab')
}
