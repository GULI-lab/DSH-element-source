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
import { resolveLocation, API_PREFIX } from './api.ts'

/** Same sandbox tokens as the built-in browser: no same-origin, no top-navigation. */
const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox'

const COPY: Record<string, { zh: string; en: string }> = {
  addressPlaceholder: { zh: '输入你的开发页面地址，如 http://localhost:5173', en: 'Enter your dev page URL, e.g. http://localhost:5173' },
  addressHint: { zh: '这里预览你自己的页面，不是 DSH 界面', en: 'This previews YOUR page, not the DSH UI itself' },
  go: { zh: '打开', en: 'Go' },
  openExternal: { zh: '外部打开', en: 'Open externally' },
  pickMode: { zh: '拾取模式', en: 'Pick mode' },
  pickModeHint: { zh: '在页面内移动鼠标高亮目标，点击后自动退出拾取', en: 'Hover to highlight, click to pick (auto-exits)' },
  sandbox: { zh: '沙箱', en: 'Sandbox' },
  sandboxHint: { zh: '开启后页面与 DSH 隔离；关掉才能让 dev 页面用 localStorage/登录态', en: 'Isolates the page from DSH; turn off so the dev page can use localStorage/auth' },
  sandboxOffWarning: { zh: '沙箱已关闭：页面与 DSH 同源，可访问本地数据，仅用于你完全信任的页面', en: 'Sandbox OFF: the page runs same-origin with DSH and can access local data — trusted pages only' },
  modeProxy: { zh: '代理模式（免改项目）', en: 'Proxy (no project changes)' },
  modeDirect: { zh: '直连模式', en: 'Direct' },
  proxyNote: { zh: '代理模式：插件转发页面并自动注入探针，无需修改项目代码；页面与 DSH 同源，仅用于你信任的本机 dev server', en: 'Proxy mode: the plugin forwards the page and injects the probe automatically — no project changes needed; the page runs same-origin with DSH, local trusted dev servers only' },
  directNote: { zh: '直连模式：页面保持自身源；点击定位需要页面加载探针（index.html 加一行，或用 Vite 插件）', en: 'Direct mode: the page keeps its own origin; picking needs the probe loaded in the page (one script line, or the Vite plugin)' },
  probeReady: { zh: '探针已就绪', en: 'Probe ready' },
  probeMissing: { zh: '页面未加载探针（点击不会生效）', en: 'Probe not loaded on this page (clicks will do nothing)' },
  resolving: { zh: '正在定位源码…', en: 'Locating source…' },
  located: { zh: '已定位', en: 'Located' },
  notLocated: { zh: '未能定位', en: 'Not located' },
  openInEditor: { zh: '在编辑器打开', en: 'Open in editor' },
  copyPath: { zh: '复制路径', en: 'Copy path' },
  copied: { zh: '已复制', en: 'Copied' },
  sendToChat: { zh: '发送到聊天', en: 'Send to chat' },
  notSteeredHint: { zh: '点击只记录结果，尚未通知助手——确认后点「发送到聊天」', en: 'Pick recorded only; the agent is not notified yet — click "Send to chat" when ready' },
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
  // Preview mode: proxy forwards the page through the plugin host and
  // auto-injects the probe (zero project changes); direct loads the URL as-is
  // and needs the probe present in the page.
  const [mode, setMode] = useState<'proxy' | 'direct'>('proxy')
  const [navigationId, setNavigationId] = useState(0)
  // Sandbox only applies in direct mode; proxy mode is same-origin by design.
  const [sandboxed, setSandboxed] = useState(true)
  // Whether inject.js announced itself from the current page (hello message).
  const [probeReady, setProbeReady] = useState(false)
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

  const changeMode = (next: 'proxy' | 'direct'): void => {
    if (next === mode) return
    setMode(next)
    setResult(null)
    setStatus(null)
    setProbeReady(false)
  }

  const navigate = (raw: string): void => {
    const normalized = normalizePreviewUrl(raw)
    if (normalized.kind === 'ok') {
      setUrl(normalized.url)
      setInput(normalized.url)
      setResult(null)
      setStatus(null)
      setProbeReady(false)
      setNavigationId(id => id + 1)
      return
    }
    setStatus(normalized.kind === 'blocked' ? '仅支持 http/https 地址' : t('addressPlaceholder'))
  }

  // The iframe source: proxied document (same-origin, probe auto-injected) or
  // the direct URL. `navigationId` keeps the src stable across re-renders and
  // forces a fresh proxied document on each navigation.
  const iframeSrc = url === undefined ? undefined : mode === 'proxy'
    ? `${API_PREFIX}/preview?url=${encodeURIComponent(url)}&v=${navigationId}`
    : url
  const effectiveSandbox = mode === 'direct' && sandboxed ? IFRAME_SANDBOX : undefined

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
      if (!located.ok) {
        const cwdHint = scope.cwd !== undefined && scope.cwd !== ''
          ? `（会话工作区：${scope.cwd}）`
          : ''
        setStatus(`${located.error ?? t('notLocated')}${cwdHint}`)
      }
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

  // Probe messages from the iframe (hello, pick results, cancel).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      if (!isProbeMessage(event.data)) return
      const data = event.data as Record<string, unknown>
      if (data.type === 'dsh-es:hello') {
        setProbeReady(true)
      } else if (data.type === 'dsh-es:pick') {
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
      {url === undefined && <div style={{ fontSize: 11, opacity: 0.6 }}>{t('addressHint')}</div>}

      {/* Mode selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="radio" name="es-mode" checked={mode === 'proxy'} onChange={() => changeMode('proxy')} />
          <span>{t('modeProxy')}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="radio" name="es-mode" checked={mode === 'direct'} onChange={() => changeMode('direct')} />
          <span>{t('modeDirect')}</span>
        </label>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{mode === 'proxy' ? t('proxyNote') : t('directNote')}</span>
      </div>

      {/* Controls: pick mode, sandbox (direct only), probe status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={picking} disabled={url === undefined} onChange={togglePicking} />
          <span>{t('pickMode')}</span>
        </label>
        {mode === 'direct' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', opacity: url === undefined ? 0.5 : 1 }} title={t('sandboxHint')}>
            <input
              type="checkbox"
              checked={sandboxed}
              disabled={url === undefined}
              onChange={event => setSandboxed(event.target.checked)}
            />
            <span>{t('sandbox')}</span>
          </label>
        )}
        {url !== undefined && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
              background: probeReady ? '#2ecc71' : '#e74c3c',
            }} />
            <span style={{ opacity: 0.85 }}>{probeReady ? t('probeReady') : t('probeMissing')}</span>
          </span>
        )}
        {picking && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('pickModeHint')}</span>}
        {!picking && url === undefined && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('noUrl')}</span>}
      </div>
      {url !== undefined && mode === 'direct' && !sandboxed && (
        <div style={{ fontSize: 11, borderRadius: 6, padding: '4px 8px', border: '1px solid #e74c3c', color: '#e74c3c' }}>
          {t('sandboxOffWarning')}
        </div>
      )}

      {/* Preview iframe */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--dsw-border, #3a3f4b)' }}>
        {url === undefined ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, opacity: 0.6 }}>
            {t('noUrl')}
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={openInEditor} style={buttonStyle}>{t('openInEditor')}</button>
            <button type="button" onClick={copyPath} style={buttonStyle}>{copied ? t('copied') : t('copyPath')}</button>
            {result.steered === false && (
              <button type="button" onClick={() => void sendToChat()} style={buttonStyle}>{t('sendToChat')}</button>
            )}
            {result.steered === false && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('notSteeredHint')}</span>}
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
