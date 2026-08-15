/**
 * Shared inline SVG icons and the icon-button chrome for the standalone UI.
 * Stroke = currentColor; the theme supplies colors through CSS variables.
 */
import React from 'react'

export type IconName =
  | 'arrow-right' | 'external' | 'crosshair' | 'wifi' | 'wifi-off' | 'refresh' | 'x'

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  external: <><path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M19 14v5H5V5h5" /></>,
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5.5 5.5 0 0 1 7 0" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /></>,
  'wifi-off': <><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5.5 5.5 0 0 1 3.5-1.5" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /><path d="M2.5 2.5l19 19" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 4v7h-7" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
}

/** Inline SVG icon (24px grid, stroke = currentColor). */
export function Icon(props: { name: IconName; size?: number; color?: string }): React.ReactElement {
  const { name, size = 15, color } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

/** One compact icon button (tooltip instead of text). */
export function IconButton(props: {
  icon: IconName
  title: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}): React.ReactElement {
  const { icon, title, onClick, active, danger, disabled } = props
  const accent = 'var(--dsw-alias-brand-primary, #4f8cff)'
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 7, cursor: disabled ? 'default' : 'pointer',
        border: '1px solid',
        borderColor: active ? accent : 'var(--dsw-alias-border-l1, #3a3f4b)',
        background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 18%, transparent)' : 'transparent',
        color: danger ? 'var(--dsw-alias-state-error-primary, #e74c3c)' : active ? accent : 'inherit',
        opacity: disabled ? 0.4 : 1,
        padding: 0,
      }}
    >
      <Icon name={icon} />
    </button>
  )
}
