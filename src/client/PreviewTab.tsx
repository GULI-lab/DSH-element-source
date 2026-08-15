/**
 * The "Local preview" tab: an address bar plus a preview iframe that CAN load
 * loopback URLs (localhost dev servers) — unlike the built-in sidebar browser
 * which refuses them. Select mode highlights the hovered element and, on
 * click, posts its metadata back; the located source (`file:line`) is shown
 * under the iframe and filled into the chat composer draft (never sent).
 *
 * The toolbar is icon-first: buttons carry inline SVG icons and tooltips
 * instead of text. Proxy mode is the primary path (no project changes);
 * Direct mode stays available as an icon toggle for apps whose data layer
 * uses same-origin relative API calls.
 *
 * Styling uses inline styles only (no CSS modules) to keep the standalone
 * build dependency-free.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar'
import {
  isProbeMessage,
  normalizePreviewUrl,
  pickFromUnknown,
  type ResolveResult,
} from '../protocol.ts'
import { resolveLocation, API_PREFIX } from './api.ts'
import { appendToDraft, buildDraftText } from './draft.ts'

/** Same sandbox tokens as the built-in browser: no same-origin, no top-navigation. */
const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox'

const COPY: Record<string, { zh: string; en: string }> = {
  addressPlaceholder: { zh: 'http://localhost:5173', en: 'http://localhost:5173' },
  open: { zh: '打开', en: 'Open' },
  openExternal: { zh: '外部打开', en: 'Open externally' },
  selectMode: { zh: '点击元素定位源码', en: 'Click an element to locate its source' },
  selectModeOn: { zh: '点击元素定位源码', en: 'Click an element to locate its source' },
  sandbox: { zh: '沙箱（与 DSH 隔离）', en: 'Sandbox (isolated from DSH)' },
  sandboxOff: { zh: '沙箱已关闭', en: 'Sandbox off' },
  sandboxOffWarning: { zh: '沙箱已关闭：页面与 DSH 同源，仅用于信任的页面', en: 'Sandbox off: the page runs same-origin with DSH — trusted pages only' },
  modeProxy: { zh: '代理模式（免改项目）', en: 'Proxy mode (no project changes)' },
  modeDirect: { zh: '直连模式', en: 'Direct mode' },
  probeReady: { zh: '探针在线', en: 'Probe online' },
  probeMissing: { zh: '探针离线', en: 'Probe offline' },
  resolving: { zh: '定位中…', en: 'Locating…' },
  notLocated: { zh: '未定位', en: 'Not located' },
}

/** Resolve the current UI language from the shell (<html lang="…">). */
function useIsZh(): boolean {
  const [isZh, setIsZh] = useState(() => document.documentElement.lang.toLowerCase().startsWith('zh'))
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsZh(document.documentElement.lang.toLowerCase().startsWith('zh'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, [])
  return isZh
}

/** Inline SVG icon (24px grid, stroke = currentColor). */
function Icon(props: { name: IconName; size?: number; color?: string }): React.ReactElement {
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

type IconName =
  | 'arrow-right' | 'external' | 'crosshair' | 'shield' | 'shield-off'
  | 'wifi' | 'wifi-off' | 'relay' | 'link' | 'refresh' | 'x'

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  external: <><path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M19 14v5H5V5h5" /></>,
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></>,
  'shield-off': <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M3 3l18 18" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5.5 5.5 0 0 1 7 0" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /></>,
  'wifi-off': <><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5.5 5.5 0 0 1 3.5-1.5" /><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" /><path d="M2.5 2.5l19 19" /></>,
  relay: <><path d="M3 6h13M16 6l-3-3M16 6l-3 3" /><path d="M21 18H8M8 18l3-3M8 18l3 3" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 4v7h-7" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
}

/** One compact icon button (tooltip instead of text). */
function IconButton(props: {
  icon: IconName
  title: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}): React.ReactElement {
  const { icon, title, onClick, active, danger, disabled } = props
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
        borderColor: active ? '#4f8cff' : 'var(--dsw-border, #3a3f4b)',
        background: active ? 'rgba(79,140,255,0.18)' : 'transparent',
        color: danger ? '#e74c3c' : active ? '#4f8cff' : 'inherit',
        opacity: disabled ? 0.4 : 1,
        padding: 0,
      }}
    >
      <Icon name={icon} />
    </button>
  )
}

/** The plugin's tab component (better-sidebar TabDescriptor.component). */
export function PreviewTab(props: TabComponentProps) {
  const { ctx, scope } = props
  const isZh = useIsZh()
  const t = useCallback((key: string): string => (COPY[key]?.[isZh ? 'zh' : 'en'] ?? key), [isZh])

  const [url, setUrl] = useState<string | undefined>()
  const [input, setInput] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [mode, setMode] = useState<'proxy' | 'direct'>('proxy')
  const [navigationId, setNavigationId] = useState(0)
  const [sandboxed, setSandboxed] = useState(true)
  const [probeReady, setProbeReady] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const postToProbe = useCallback((message: unknown): void => {
    const frame = iframeRef.current
    if (frame === null || frame.contentWindow === null) return
    frame.contentWindow.postMessage(message, '*')
  }, [])

  const resetForNavigation = useCallback((): void => {
    setResult(null)
    setStatus(null)
    setProbeReady(false)
    setSelecting(false)
  }, [])

  const navigate = (raw: string): void => {
    const normalized = normalizePreviewUrl(raw)
    if (normalized.kind === 'ok') {
      setUrl(normalized.url)
      setInput(normalized.url)
      resetForNavigation()
      setNavigationId(id => id + 1)
      return
    }
    setStatus(normalized.kind === 'blocked' ? '仅支持 http/https' : t('addressPlaceholder'))
  }

  const toggleMode = (): void => {
    setMode(previous => (previous === 'proxy' ? 'direct' : 'proxy'))
    resetForNavigation()
  }

  const iframeSrc = url === undefined ? undefined : mode === 'proxy'
    ? `${API_PREFIX}/preview?url=${encodeURIComponent(url)}&v=${navigationId}`
    : url
  const effectiveSandbox = mode === 'direct' && sandboxed ? IFRAME_SANDBOX : undefined

  const handlePick = useCallback(async (rawPick: unknown): Promise<void> => {
    const pick = pickFromUnknown(rawPick)
    setSelecting(false)
    if (pick === undefined) {
      setStatus(t('notLocated'))
      return
    }
    setResult(null)
    setStatus(t('resolving'))
    try {
      const located = await resolveLocation({ sessionId: scope.sessionId, cwd: scope.cwd, pick })
      setResult(located)
      setStatus(null)
      if (located.ok === true) {
        // Fill the chat composer draft (never send): the user decides.
        appendToDraft(ctx, scope.sessionId, buildDraftText(located))
      } else {
        const cwdHint = scope.cwd !== undefined && scope.cwd !== ''
          ? `（cwd: ${scope.cwd}）`
          : ''
        setStatus(`${located.error ?? t('notLocated')}${cwdHint}`)
      }
    } catch (error) {
      setResult(null)
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [scope, t, ctx])

  // Probe messages from the iframe (hello, select, pick-cancel).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      if (!isProbeMessage(event.data)) return
      const data = event.data as Record<string, unknown>
      if (data.type === 'dsh-es:hello') {
        setProbeReady(true)
      } else if (data.type === 'dsh-es:pick' || data.type === 'dsh-es:select') {
        void handlePick(data.pick)
      } else if (data.type === 'dsh-es:pick-cancel') {
        setSelecting(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handlePick])

  const toggleSelecting = (): void => {
    const next = !selecting
    setSelecting(next)
    setStatus(null)
    postToProbe({ type: 'dsh-es:set-mode', mode: next })
  }

  const clearSelection = (): void => {
    setSelecting(false)
    postToProbe({ type: 'dsh-es:set-mode', mode: false })
    setResult(null)
    setStatus(null)
  }

  const locationText = result?.ok === true
    ? (result.line !== undefined ? `${result.relative}:${result.line}` : result.relative)
    : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 7, padding: 8, boxSizing: 'border-box' }}>
      {/* Address bar */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <input
          value={input}
          placeholder={t('addressPlaceholder')}
          spellCheck={false}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') navigate(input) }}
          style={{
            flex: 1, minWidth: 0, padding: '5px 9px', borderRadius: 7, fontSize: 12,
            border: '1px solid var(--dsw-border, #3a3f4b)',
            background: 'transparent', color: 'inherit', font: 'inherit',
          }}
        />
        <IconButton icon="arrow-right" title={t('open')} onClick={() => navigate(input)} disabled={input.trim() === ''} />
        {url !== undefined && (
          <IconButton icon="external" title={t('openExternal')} onClick={() => window.open(url, '_blank', 'noopener')} />
        )}
      </div>

      {/* Toolbar: select / mode / sandbox / probe status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconButton
          icon="crosshair"
          title={`${t('selectMode')}${selecting ? ` · ${t('selectModeOn')}` : ''}`}
          onClick={toggleSelecting}
          active={selecting}
          disabled={url === undefined}
        />
        <IconButton
          icon={mode === 'proxy' ? 'relay' : 'link'}
          title={mode === 'proxy' ? t('modeProxy') : t('modeDirect')}
          onClick={toggleMode}
        />
        {mode === 'direct' && (
          <IconButton
            icon={sandboxed ? 'shield' : 'shield-off'}
            title={sandboxed ? t('sandbox') : t('sandboxOff')}
            onClick={() => setSandboxed(previous => !previous)}
            danger={!sandboxed}
            disabled={url === undefined}
          />
        )}
        <span style={{ flex: 1 }} />
        {url !== undefined && (
          <span
            title={probeReady ? t('probeReady') : t('probeMissing')}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <Icon name={probeReady ? 'wifi' : 'wifi-off'} color={probeReady ? '#2ecc71' : '#e74c3c'} size={16} />
          </span>
        )}
      </div>

      {url !== undefined && mode === 'direct' && !sandboxed && (
        <div style={{ fontSize: 11, borderRadius: 6, padding: '4px 8px', border: '1px solid #e74c3c', color: '#e74c3c' }}>
          {t('sandboxOffWarning')}
        </div>
      )}
      {status !== null && <div style={{ fontSize: 11, opacity: 0.85 }}>{status}</div>}

      {/* Preview iframe */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 9, overflow: 'hidden', border: '1px solid var(--dsw-border, #3a3f4b)' }}>
        {url === undefined ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="external" color="rgba(127,127,127,0.5)" size={28} />
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            sandbox={effectiveSandbox}
            referrerPolicy="no-referrer"
            allow=""
            title={url}
            onLoad={() => postToProbe({ type: 'dsh-es:ping' })}
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        )}
        {selecting && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            border: '2px dashed #4f8cff', borderRadius: 7, opacity: 0.55,
          }} />
        )}
      </div>

      {/* Located source */}
      {result !== null && result.ok === true && locationText !== undefined && (
        <div style={{
          borderRadius: 8, padding: '6px 10px', fontSize: 12,
          border: '1px solid var(--dsw-border, #3a3f4b)', display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{locationText}</code>
          {result.snippet !== undefined && (
            <pre style={{
              margin: 0, overflow: 'auto', maxHeight: 110, fontSize: 11,
              padding: 5, borderRadius: 6, background: 'rgba(127,127,127,0.1)',
            }}>{result.snippet}</pre>
          )}
        </div>
      )}
    </div>
  )
}
