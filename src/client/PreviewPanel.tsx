/**
 * The standalone preview panel: an address bar plus a proxied preview iframe
 * that CAN load loopback URLs (localhost dev servers) — unlike the built-in
 * sidebar browser which refuses them. The host forwards the page and
 * auto-injects the probe, so picking works with zero project changes. Select
 * mode highlights the hovered element and, on click, posts its metadata back;
 * the located source (`file:line`) is shown under the iframe and filled into
 * the chat composer draft (never sent).
 *
 * The toolbar is icon-first: buttons carry inline SVG icons and tooltips
 * instead of text. Colors use the DSH theme tokens so the panel blends into
 * the GUI in both light and dark themes.
 *
 * Styling uses inline styles only (no CSS modules) to keep the standalone
 * build dependency-free.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  isProbeMessage,
  normalizePreviewUrl,
  pickFromUnknown,
  type ResolveResult,
} from '../protocol.ts'
import { resolveLocation, API_PREFIX } from './api.ts'
import { appendToDraft, buildDraftText, type DraftContext } from './draft.ts'
import { Icon, IconButton, type IconName } from './icons.tsx'

const COPY: Record<string, { zh: string; en: string }> = {
  addressPlaceholder: { zh: '输入URL或正在运行的服务', en: 'Enter a URL or a running service' },
  open: { zh: '打开', en: 'Open' },
  openExternal: { zh: '外部打开', en: 'Open externally' },
  selectMode: { zh: '点击元素定位源码', en: 'Click an element to locate its source' },
  refresh: { zh: '刷新页面', en: 'Reload page' },
  probeReady: { zh: '探针在线', en: 'Probe online' },
  probeMissing: { zh: '探针离线', en: 'Probe offline' },
  resolving: { zh: '定位中…', en: 'Locating…' },
  notLocated: { zh: '未定位', en: 'Not located' },
  noSession: { zh: '请先打开一个会话', en: 'Open a session first' },
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

/** The standalone preview panel (hosted in the frame-wide overlay or a sidebar tab). */
export function PreviewPanel(props: { ctx: DraftContext; sessionId?: string; cwd?: string }): React.ReactElement {
  const { ctx, sessionId, cwd } = props
  const isZh = useIsZh()
  const t = useCallback((key: string): string => (COPY[key]?.[isZh ? 'zh' : 'en'] ?? key), [isZh])

  const [url, setUrl] = useState<string | undefined>()
  const [input, setInput] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [navigationId, setNavigationId] = useState(0)
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

  /** Reload the current page (fresh proxied document + probe). */
  const reload = (): void => {
    if (url === undefined) return
    resetForNavigation()
    setNavigationId(id => id + 1)
  }

  // Always the proxied document: same-origin with the GUI, probe auto-injected.
  const iframeSrc = url === undefined ? undefined : `${API_PREFIX}/preview?url=${encodeURIComponent(url)}&v=${navigationId}`

  const handlePick = useCallback(async (rawPick: unknown): Promise<void> => {
    const pick = pickFromUnknown(rawPick)
    if (pick === undefined || sessionId === undefined) {
      setStatus(t('notLocated'))
      return
    }
    setResult(null)
    setStatus(t('resolving'))
    try {
      const located = await resolveLocation({ sessionId, cwd, pick })
      setResult(located)
      setStatus(null)
      if (located.ok === true) {
        // Fill the chat composer draft (never send): the user decides.
        appendToDraft(ctx, sessionId, buildDraftText(located))
      } else {
        const cwdHint = cwd !== undefined && cwd !== ''
          ? `（cwd: ${cwd}）`
          : ''
        setStatus(`${located.error ?? t('notLocated')}${cwdHint}`)
      }
    } catch (error) {
      setResult(null)
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId, cwd, t, ctx])

  // Probe messages from the iframe (hello, select, pick-cancel).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      if (!isProbeMessage(event.data)) return
      const data = event.data as Record<string, unknown>
      if (data.type === 'dsh-es:hello') {
        setProbeReady(true)
      } else if (data.type === 'dsh-es:select' || data.type === 'dsh-es:pick') {
        // A null pick means the selection was cleared (click-again / Esc).
        if (data.pick === null || data.pick === undefined) {
          setResult(null)
          setStatus(null)
        } else {
          void handlePick(data.pick)
        }
      } else if (data.type === 'dsh-es:pick-cancel') {
        setSelecting(false)
        setResult(null)
        setStatus(null)
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

  const locationText = result?.ok === true
    ? (result.line !== undefined ? `${result.relative}:${result.line}` : result.relative)
    : undefined

  const border = 'var(--dsw-alias-border-l1, #3a3f4b)'

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
            border: `1px solid ${border}`,
            background: 'transparent', color: 'inherit', font: 'inherit',
          }}
        />
        <IconButton icon="arrow-right" title={t('open')} onClick={() => navigate(input)} disabled={input.trim() === ''} />
        {url !== undefined && (
          <IconButton icon="refresh" title={t('refresh')} onClick={reload} />
        )}
        {url !== undefined && (
          <IconButton icon="external" title={t('openExternal')} onClick={() => window.open(url, '_blank', 'noopener')} />
        )}
      </div>

      {/* Toolbar: select / probe status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconButton
          icon="crosshair"
          title={t('selectMode')}
          onClick={toggleSelecting}
          active={selecting}
          disabled={url === undefined}
        />
        <span style={{ flex: 1 }} />
        {url !== undefined && (
          <span
            title={probeReady ? t('probeReady') : t('probeMissing')}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <Icon
              name={probeReady ? 'wifi' : 'wifi-off'}
              color={probeReady
                ? 'var(--dsw-alias-state-success-primary, #2ecc71)'
                : 'var(--dsw-alias-state-error-primary, #e74c3c)'}
              size={16}
            />
          </span>
        )}
      </div>

      {status !== null && (
        <div style={{ fontSize: 11, opacity: 0.85, color: 'var(--dsw-alias-label-secondary, inherit)' }}>{status}</div>
      )}

      {/* Preview iframe (proxied, same-origin, probe auto-injected) */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 9, overflow: 'hidden', border: `1px solid ${border}` }}>
        {sessionId === undefined ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, opacity: 0.6 }}>
            {t('noSession')}
          </div>
        ) : url === undefined ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="external" color="rgba(127,127,127,0.5)" size={28} />
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
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
            border: '2px dashed var(--dsw-alias-brand-primary, #4f8cff)', borderRadius: 7, opacity: 0.55,
          }} />
        )}
      </div>

      {/* Located source */}
      {result !== null && result.ok === true && locationText !== undefined && (
        <div style={{
          borderRadius: 8, padding: '6px 10px', fontSize: 12,
          border: `1px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 3,
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

/** Icon names the panel uses (re-exported for the launcher FAB). */
export type { IconName }
