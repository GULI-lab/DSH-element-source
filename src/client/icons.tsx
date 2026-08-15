/**
 * Shared inline SVG icons and the icon-button chrome for the standalone UI.
 * Stroke = currentColor; the theme supplies colors through CSS variables.
 */
import React from 'react'

export type IconName =
  | 'arrow-right' | 'external' | 'crosshair' | 'wifi' | 'wifi-off' | 'refresh' | 'x' | 'browser'

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  external: <><path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M19 14v5H5V5h5" /></>,
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5.5 5.5 0 0 1 7 0" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /></>,
  'wifi-off': <><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5.5 5.5 0 0 1 3.5-1.5" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /><path d="M2.5 2.5l19 19" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 4v7h-7" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  // The user's browser icon (D:/Download/浏览器.svg), inlined as filled paths.
  browser: <>
    <path d="M485.376 931.84c-231.424 0-419.84-188.416-419.84-419.84s188.416-419.84 419.84-419.84c197.632 0 370.688 140.288 410.624 333.824 2.048 11.264 4.096 23.552 6.144 34.816 2.048 16.384-10.24 31.744-26.624 33.792-16.384 2.048-31.744-10.24-33.792-26.624-1.024-10.24-3.072-20.48-5.12-29.696-34.816-165.888-182.272-286.72-352.256-286.72-197.632 1.024-358.4 161.792-358.4 360.448S286.72 871.424 485.376 871.424c177.152 0 329.728-132.096 355.328-306.176 2.048-16.384 17.408-27.648 33.792-25.6 16.384 2.048 27.648 17.408 25.6 33.792C870.4 778.24 691.2 931.84 485.376 931.84z" fill="currentColor" stroke="none" />
    <path d="M95.232 758.784c-45.056 0-70.656-12.288-80.896-36.864-19.456-45.056 34.816-94.208 77.824-126.976 13.312-10.24 31.744-8.192 41.984 5.12 10.24 13.312 8.192 31.744-5.12 41.984-36.864 28.672-51.2 46.08-56.32 55.296 39.936 10.24 202.752-16.384 464.896-130.048 262.144-113.664 393.216-215.04 412.672-250.88-12.288-3.072-47.104-5.12-131.072 14.336-16.384 4.096-32.768-6.144-35.84-22.528-4.096-16.384 6.144-32.768 22.528-35.84 122.88-28.672 185.344-22.528 203.776 18.432 17.408 40.96-19.456 90.112-121.856 158.72-82.944 56.32-198.656 117.76-325.632 173.056-126.976 55.296-250.88 98.304-349.184 119.808-48.128 11.264-87.04 16.384-117.76 16.384z" fill="currentColor" stroke="none" />
  </>,
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
