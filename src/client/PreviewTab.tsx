/**
 * The "Local preview" tab: an address bar plus a sandboxed iframe that CAN
 * load loopback URLs (localhost dev servers) — unlike the built-in sidebar
 * browser which refuses them. On top sits the pick-mode toggle: while on, the
 * page probe (inject.js) draws a hover outline and posts the clicked element
 * back here; the result panel shows the located source and offers to open the
 * file in the sidebar editor or copy its path.
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
  type ElementPick,
  type ResolveResult,
} from '../protocol.ts'
import { resolveLocation } from './api.ts'

/** Same sandbox tokens as the built-in browser: no same-origin, no top-navigation. */
const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox'

const COPY: Record<string, { zh: string; en: string }> = {
  addressPlaceholder: { zh: '输入地址，如 http://localhost:5173', en: 'Enter a URL, e.g. http://localhost:5173' },
  go: { zh: '打开', en: 'Go' },
  openExternal: { zh: '外部打开', en: 'Open externally' },
  pickMode: { zh: '拾取模式', en: 'Pick mode' },
  pickModeOn: { zh: '开启后点击页面元素即可定位源码', en: 'Click any page element to locate its source' },
  pickModeHint: { zh: '在页面内移动鼠标高亮目标，点击后自动退出拾取', en: 'Hover to highlight, click to pick (auto-exits)' },
  resolving: { zh: '正在定位源码…', en: 'Locating source…' },
  located: { zh: '已定位', en: 'Located' },
  notLocated: { zh: '未能定位', en: 'Not located' },
  openInEditor: { zh: '在编辑器打开', en: 'Open in editor' },
  copyPath: { zh: '复制路径', en: 'Copy path' },
  copied: { zh: '已复制', en: 'Copied' },
  sendToChat: { zh: '发送到聊天', en: 'Send to chat' },
  steered: { zh: '已通知助手，聊天将展示源码', en: 'Agent notified; the chat will show the source' },
  methodLabel: { zh: '定位方式', en: 'Method' },
  noUrl: { zh: '先输入地址打开页面', en: 'Enter a URL first' },
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

/** The plugin's tab component (better-sidebar TabDescriptor.component). */
export function PreviewTab(props: TabComponentProps) {
  const { ctx, scope } = props
  const isZh = useIsZh()
  const t = useCallback((key: string): string => (COPY[key]?.[isZh ? 'zh' : 'en'] ?? key), [isZh])

  const [url, setUrl] = useState<string | undefined>()
  const [input, setInput] = useState('')
  const [picking, setPicking] = useState(false)
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // The last validated pick, kept for re-steer ("发送到聊天").
  const lastPickRef = useRef<ElementPick | null>(null)

  const rememberPick = useCallback((pick: ElementPick): void => {
    lastPickRef.current = pick
  }, [])

  const postToProbe = useCallback((message: unknown): void => {
    const frame = iframeRef.current
    if (frame === null || frame.contentWindow === null) return
    frame.contentWindow.postMessage(message, '*')
  }, [])

  const navigate = (raw: string): void => {
    const normalized = normalizePreviewUrl(raw)
    if (normalized.kind === 'ok') {
      setUrl(normalized.url)
      setInput(normalized.url)
      setResult(null)
      setStatus(null)
      return
    }
    setStatus(normalized.kind === 'blocked' ? '仅支持 http/https 地址' : t('addressPlaceholder'))
  }

  const handlePick = useCallback(async (rawPick: unknown): Promise<void> => {
    const pick = pickFromUnknown(rawPick)
    setPicking(false)
    if (pick === undefined) {
      setStatus('无效的拾取数据')
      return
    }
    setResult(null)
    setStatus(t('resolving'))
    try {
      const located = await resolveLocation({
        sessionId: scope.sessionId,
        cwd: scope.cwd,
        pick,
      })
      setResult(located)
      setStatus(null)
      if (!located.ok) setStatus(located.error ?? t('notLocated'))
    } catch (error) {
      setResult(null)
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [scope, t])

  const sendToChat = useCallback(async (): Promise<void> => {
    if (result === null || result.ok !== true || result.file === undefined) return
    const pick = lastPickRef.current
    if (pick === null) return
    setStatus(t('resolving'))
    try {
      const located = await resolveLocation({
        sessionId: scope.sessionId,
        cwd: scope.cwd,
        pick,
        autoSteer: true,
      })
      setResult(located)
      setStatus(located.ok === true && located.steered ? t('steered') : null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [result, scope, t])

  // Probe messages from the iframe (pick results, cancel).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      if (!isProbeMessage(event.data)) return
      const data = event.data as Record<string, unknown>
      if (data.type === 'dsh-es:pick') {
        const pick = pickFromUnknown(data.pick)
        if (pick !== undefined) {
          rememberPick(pick)
          void handlePick(pick)
        }
      } else if (data.type === 'dsh-es:pick-cancel') {
        setPicking(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handlePick, rememberPick])

  const togglePicking = (): void => {
    const next = !picking
    setPicking(next)
    setResult(null)
    setStatus(null)
    postToProbe({ type: 'dsh-es:set-mode', mode: next })
  }

  const openInEditor = (): void => {
    if (result?.ok !== true || result.file === undefined) return
    ctx.betterSidebar.openTab({ type: 'editor', path: result.file })
  }

  const copyPath = (): void => {
    if (result?.ok !== true) return
    const text = result.relative ?? result.file
    if (text === undefined) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  const methodBadge = result?.ok === true ? result.method : null
  const locationText = result?.ok === true
    ? (result.line !== undefined ? `${result.relative}:${result.line}` : result.relative)
    : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 6, padding: 8, boxSizing: 'border-box' }}>
      {/* Address bar */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={input}
          placeholder={t('addressPlaceholder')}
          spellCheck={false}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') navigate(input) }}
          style={{
            flex: 1, minWidth: 0, padding: '4px 8px', borderRadius: 6,
            border: '1px solid var(--dsw-border, #3a3f4b)',
            background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12,
          }}
        />
        <button type="button" onClick={() => navigate(input)} style={buttonStyle}>{t('go')}</button>
        {url !== undefined && (
          <button type="button" onClick={() => window.open(url, '_blank', 'noopener')} style={buttonStyle}>
            {t('openExternal')}
          </button>
        )}
      </div>

      {/* Pick-mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={picking} disabled={url === undefined} onChange={togglePicking} />
          <span>{t('pickMode')}</span>
        </label>
        {picking && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('pickModeHint')}</span>}
        {!picking && url === undefined && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('noUrl')}</span>}
      </div>

      {/* Preview iframe */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--dsw-border, #3a3f4b)' }}>
        {url === undefined ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, opacity: 0.6 }}>
            {t('noUrl')}
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={url}
            sandbox={IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
            allow=""
            title={url}
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        )}
        {picking && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            border: '2px dashed #4f8cff', borderRadius: 6, opacity: 0.6,
          }} />
        )}
      </div>

      {/* Status / result panel */}
      {status !== null && <div style={{ fontSize: 12, opacity: 0.85 }}>{status}</div>}
      {result !== null && result.ok === true && locationText !== undefined && (
        <div style={{
          fontSize: 12, borderRadius: 8, padding: '8px 10px',
          border: '1px solid var(--dsw-border, #3a3f4b)', display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>{t('located')}</strong>
            <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{locationText}</code>
            {methodBadge !== null && (
              <span style={{ fontSize: 10, opacity: 0.7 }}>{t('methodLabel')}: {methodBadge}</span>
            )}
          </div>
          {result.snippet !== undefined && (
            <pre style={{
              margin: 0, overflow: 'auto', maxHeight: 120, fontSize: 11,
              padding: 6, borderRadius: 6, background: 'rgba(127,127,127,0.12)',
            }}>{result.snippet}</pre>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={openInEditor} style={buttonStyle}>{t('openInEditor')}</button>
            <button type="button" onClick={copyPath} style={buttonStyle}>{copied ? t('copied') : t('copyPath')}</button>
            {result.steered === false && (
              <button type="button" onClick={() => void sendToChat()} style={buttonStyle}>{t('sendToChat')}</button>
            )}
            {result.steered === true && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('steered')}</span>}
          </div>
        </div>
      )}
      {result !== null && result.ok === false && (
        <div style={{ fontSize: 12, borderRadius: 8, padding: '8px 10px', border: '1px solid var(--dsw-danger, #c0392b)' }}>
          <strong>{t('notLocated')}: </strong>{result.error}
        </div>
      )}
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--dsw-border, #3a3f4b)', background: 'transparent', color: 'inherit',
  whiteSpace: 'nowrap',
}
