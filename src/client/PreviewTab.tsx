/**
 * Better-sidebar tab adapter: when dsh-better-sidebar is installed, the
 * preview panel is mounted as its "Local preview" tab (the preferred entry);
 * the standalone right sidebar is suppressed in that case. This file is
 * type-only dependent on better-sidebar, so it compiles even when the runtime
 * does not have the sidebar.
 */
import React from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar'
import { PreviewPanel } from './PreviewPanel.tsx'

/** Adapt better-sidebar's tab props to the standalone panel props. */
export function PreviewTab(props: TabComponentProps): React.ReactElement {
  return React.createElement(PreviewPanel, {
    ctx: props.ctx,
    sessionId: props.scope?.sessionId,
    cwd: props.scope?.cwd,
  })
}
