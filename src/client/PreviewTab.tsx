/**
 * The "Local preview" tab: a two-column inspector.
 *
 * Left: an address bar + preview iframe that CAN load loopback URLs (the
 * built-in sidebar browser refuses them). While select mode is on, clicking
 * an element selects it persistently (green outline) and the probe posts its
 * metadata back here.
 *
 * Right: the inspector — the located source (`file:line` + method) with an
 * "add to conversation" action, the bounded component tree (click to select),
 * and the 设计 / CSS tabs (live box-property editing through the probe).
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
  type StyleInfo,
  type StylePatch,
  type TreeNode,
} from '../protocol.ts'
import { resolveLocation, API_PREFIX } from './api.ts'
import { appendToDraft, buildDraftText } from './draft.ts'

/** Same sandbox tokens as the built-in browser: no same-origin, no top-navigation. */
const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox'

const COPY: Record<string, { zh: string; en: string }> = {
  addressPlaceholder: { zh: '输入你的开发页面地址，如 http://localhost:5173', en: 'Enter your dev page URL, e.g. http://localhost:5173' },
  addressHint: { zh: '这里预览你自己的页面，不是 DSH 界面', en: 'This previews YOUR page, not the DSH UI itself' },
  go: { zh: '打开', en: 'Go' },
  openExternal: { zh: '外部打开', en: 'Open externally' },
  selectMode: { zh: '选择模式', en: 'Select mode' },
  selectModeHint: { zh: '点击页面元素选中（再点一次取消，Esc 退出）', en: 'Click an element to select (click again or Esc to clear)' },
  modeProxy: { zh: '代理模式（免改项目）', en: 'Proxy (no project changes)' },
  modeDirect: { zh: '直连模式', en: 'Direct' },
  proxyNote: { zh: '代理模式：插件转发页面并自动注入探针，无需修改项目代码', en: 'Proxy mode: the plugin forwards the page and injects the probe automatically' },
  directNote: { zh: '直连模式需要页面已加载探针（index.html 一行或 Vite 插件）', en: 'Direct mode needs the probe loaded in the page (one script line, or the Vite plugin)' },
  sandbox: { zh: '沙箱', en: 'Sandbox' },
  sandboxHint: { zh: '开启后页面与 DSH 隔离；关掉才能让 dev 页面用 localStorage/登录态', en: 'Isolates the page from DSH; turn off so the dev page can use localStorage/auth' },
  sandboxOffWarning: { zh: '沙箱已关闭：页面与 DSH 同源，可访问本地数据，仅用于你完全信任的页面', en: 'Sandbox OFF: the page runs same-origin with DSH — trusted pages only' },
  probeReady: { zh: '探针已就绪', en: 'Probe ready' },
  probeMissing: { zh: '页面未加载探针', en: 'Probe not loaded' },
  inspector: { zh: '检查器', en: 'Inspector' },
  located: { zh: '定位', en: 'Located' },
  notLocated: { zh: '未能定位', en: 'Not located' },
  methodLabel: { zh: '方式', en: 'Method' },
  addToChat: { zh: '+ 添加到对话', en: '+ Add to chat' },
  addedToDraft: { zh: '已填入聊天输入框，可补充后发送', en: 'Filled into the chat input — add wording and send' },
  components: { zh: '组件', en: 'Components' },
  noSelection: { zh: '点击左侧页面中的元素以检查', en: 'Click an element in the preview to inspect' },
  refreshTree: { zh: '刷新', en: 'Refresh' },
  clearSelection: { zh: '取消选择', en: 'Clear' },
  design: { zh: '设计', en: 'Design' },
  css: { zh: 'CSS', en: 'CSS' },
  position: { zh: '位置', en: 'Position' },
  rotation: { zh: '旋转', en: 'Rotate' },
  layout: { zh: '布局', en: 'Layout' },
  width: { zh: 'W', en: 'W' },
  height: { zh: 'H', en: 'H' },
  padding: { zh: 'Padding', en: 'Padding' },
  margin: { zh: 'Margin', en: 'Margin' },
  top: { zh: '上', en: 'Top' },
  right: { zh: '右', en: 'Right' },
  bottom: { zh: '下', en: 'Bottom' },
  left: { zh: '左', en: 'Left' },
  auto: { zh: 'auto', en: 'auto' },
  noUrl: { zh: '先输入地址打开页面', en: 'Enter a URL first' },
  applyingHint: { zh: '回车/失焦应用', en: 'Enter/blur to apply' },
  inlineStyle: { zh: '内联样式', en: 'Inline style' },
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

/** One numeric input that commits on Enter/blur (avoids spamming apply). */
function NumberField(props: {
  value: string
  unit: string
  label?: string
  onCommit: (value: string) => void
  readOnly?: boolean
}): React.ReactElement {
  const { value, unit, label, onCommit, readOnly } = props
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, minWidth: 0 }}>
      {label !== undefined && <span style={{ opacity: 0.7 }}>{label}</span>}
      <input
        value={readOnly ? value : text}
        readOnly={readOnly}
        spellCheck={false}
        onChange={event => { if (!readOnly) setText(event.target.value) }}
        onKeyDown={event => { if (event.key === 'Enter') onCommit(text) }}
        onBlur={() => { if (!readOnly) onCommit(text) }}
        style={{
          width: 44, padding: '2px 4px', borderRadius: 4, fontSize: 11,
          border: '1px solid var(--dsw-border, #3a3f4b)', background: 'transparent', color: 'inherit',
        }}
      />
      <span style={{ opacity: 0.6 }}>{unit}</span>
    </label>
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
  // Inspector state.
  const [tree, setTree] = useState<TreeNode[]>([])
  const [styleInfo, setStyleInfo] = useState<StyleInfo | null>(null)
  const [selectedPath, setSelectedPath] = useState<number[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [inspectorTab, setInspectorTab] = useState<'design' | 'css'>('design')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const postToProbe = useCallback((message: unknown): void => {
    const frame = iframeRef.current
    if (frame === null || frame.contentWindow === null) return
    frame.contentWindow.postMessage(message, '*')
  }, [])

  const changeMode = (next: 'proxy' | 'direct'): void => {
    if (next === mode) return
    setMode(next)
    clearAll()
  }

  const clearAll = useCallback((): void => {
    setResult(null)
    setStatus(null)
    setTree([])
    setStyleInfo(null)
    setSelectedPath(null)
    setProbeReady(false)
  }, [])

  const navigate = (raw: string): void => {
    const normalized = normalizePreviewUrl(raw)
    if (normalized.kind === 'ok') {
      setUrl(normalized.url)
      setInput(normalized.url)
      clearAll()
      setNavigationId(id => id + 1)
      return
    }
    setStatus(normalized.kind === 'blocked' ? '仅支持 http/https 地址' : t('addressPlaceholder'))
  }

  const iframeSrc = url === undefined ? undefined : mode === 'proxy'
    ? `${API_PREFIX}/preview?url=${encodeURIComponent(url)}&v=${navigationId}`
    : url
  const effectiveSandbox = mode === 'direct' && sandboxed ? IFRAME_SANDBOX : undefined

  /** Resolve the located source for a pick (fills the inspector result). */
  const resolvePickFor = useCallback(async (pick: ElementPick): Promise<void> => {
    setStatus(t('resolving'))
    try {
      const located = await resolveLocation({ sessionId: scope.sessionId, cwd: scope.cwd, pick })
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

  /** Handle a selection from the probe: resolve + ask for style info. */
  const handleSelect = useCallback((rawPick: unknown): void => {
    const pick = pickFromUnknown(rawPick)
    if (pick === undefined) {
      setSelectedPath(null)
      setStyleInfo(null)
      setResult(null)
      return
    }
    setSelectedPath(null)
    void resolvePickFor(pick)
    postToProbe({ type: 'dsh-es:get-style' })
  }, [postToProbe, resolvePickFor])

  const handleStyle = useCallback((rawInfo: unknown): void => {
    if (typeof rawInfo === 'object' && rawInfo !== null) {
      setStyleInfo(rawInfo as StyleInfo)
    } else {
      setStyleInfo(null)
    }
  }, [])

  const handleTree = useCallback((rawNodes: unknown): void => {
    if (Array.isArray(rawNodes)) setTree(rawNodes as TreeNode[])
  }, [])

  // Probe messages from the iframe.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      if (!isProbeMessage(event.data)) return
      const data = event.data as Record<string, unknown>
      switch (data.type) {
        case 'dsh-es:hello':
          setProbeReady(true)
          postToProbe({ type: 'dsh-es:get-tree' })
          break
        case 'dsh-es:select':
          handleSelect(data.pick)
          break
        case 'dsh-es:tree':
          handleTree(data.nodes)
          break
        case 'dsh-es:style':
          handleStyle(data.info)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleSelect, handleTree, handleStyle, postToProbe])

  const toggleSelecting = (): void => {
    const next = !selecting
    setSelecting(next)
    setStatus(null)
    if (!next) postToProbe({ type: 'dsh-es:set-mode', mode: false })
    else postToProbe({ type: 'dsh-es:set-mode', mode: true })
  }

  const clearSelection = (): void => {
    setSelecting(false)
    postToProbe({ type: 'dsh-es:set-mode', mode: false })
    postToProbe({ type: 'dsh-es:clear-selection' })
    setResult(null)
    setStyleInfo(null)
    setSelectedPath(null)
  }

  const refreshTree = (): void => {
    postToProbe({ type: 'dsh-es:get-tree' })
  }

  /** Select a tree node: ask the probe to highlight it (it replies with a select). */
  const selectPath = (path: number[]): void => {
    setSelectedPath(path)
    postToProbe({ type: 'dsh-es:select-path', path })
  }

  /** Apply a style patch to the selected element (the probe replies with style). */
  const applyStyle = (patch: Partial<StylePatch>): void => {
    postToProbe({ type: 'dsh-es:apply-style', styles: patch })
  }

  const addToChat = (): void => {
    if (result?.ok !== true) return
    const ok = appendToDraft(ctx, scope.sessionId, buildDraftText(result))
    setStatus(ok ? t('addedToDraft') : t('notLocated'))
  }

  const px = (value: number | undefined): string => (value === undefined ? '' : String(Math.round(value)))

  const toggleNode = (path: number[]): void => {
    setExpanded(previous => {
      const next = new Set(previous)
      const key = path.join('.')
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const isExpanded = (node: TreeNode, depth: number): boolean => {
    if (depth <= 1) return true
    return expanded.has(node.path.join('.'))
  }

  const renderTree = (nodes: TreeNode[], depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = []
    for (const node of nodes) {
      const key = node.path.join('.')
      const hasChildren = node.children.length > 0
      const selected = selectedPath !== null && key === selectedPath.join('.')
      const open = isExpanded(node, depth)
      rows.push(
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', padding: '1px 0', whiteSpace: 'nowrap' }}>
          <span style={{ width: depth * 12, flexShrink: 0 }} />
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleNode(node.path)}
              style={{ width: 14, height: 14, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 10, padding: 0 }}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          <span
            onClick={() => selectPath(node.path)}
            style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11,
              borderRadius: 4, padding: '1px 4px',
              background: selected ? 'rgba(79,140,255,0.25)' : 'transparent',
            }}
            title={node.text}
          >
            <span style={{ opacity: 0.85 }}>&lt;{node.tag}</span>
            {node.id !== undefined && <span style={{ color: '#e8a33d' }}>#{node.id}</span>}
            {node.classes.map(cls => <span key={cls} style={{ color: '#4f8cff' }}>.{cls}</span>)}
            {node.text !== undefined && <span style={{ opacity: 0.55 }}> {node.text}</span>}
            <span style={{ opacity: 0.85 }}>&gt;</span>
          </span>
        </div>,
      )
      if (hasChildren && open) rows.push(...renderTree(node.children, depth + 1))
    }
    return rows
  }

  // ── 设计 tab: live box-property editing ────────────────────────────────
  const designTab = styleInfo === null ? (
    <div style={{ fontSize: 11, opacity: 0.6, padding: 8 }}>{t('noSelection')}</div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>{t('position')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <NumberField label="X" value={px(styleInfo.x)} unit="px" readOnly onCommit={() => {}} />
          <NumberField label="Y" value={px(styleInfo.y)} unit="px" readOnly onCommit={() => {}} />
          <span style={{ fontSize: 11, opacity: 0.7 }}>{t('layout')}: {styleInfo.display ?? t('auto')}</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>{t('rotation')}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NumberField
            value={rotationDegOf(styleInfo.transform)}
            unit="deg"
            onCommit={(value) => applyStyle({ transform: value.trim() === '' ? '' : `rotate(${value.trim()}deg)` })}
          />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>{t('layout')}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <NumberField label={t('width')} value={px(styleInfo.width)} unit="px" onCommit={(value) => applyStyle({ width: value.trim() === '' ? '' : `${value.trim()}px` })} />
          <NumberField label={t('height')} value={px(styleInfo.height)} unit="px" onCommit={(value) => applyStyle({ height: value.trim() === '' ? '' : `${value.trim()}px` })} />
        </div>
      </div>
      {boxFields('padding', styleInfo.paddingTop, styleInfo.paddingRight, styleInfo.paddingBottom, styleInfo.paddingLeft, applyStyle, t)}
      {boxFields('margin', styleInfo.marginTop, styleInfo.marginRight, styleInfo.marginBottom, styleInfo.marginLeft, applyStyle, t)}
      <div style={{ fontSize: 10, opacity: 0.5 }}>{t('applyingHint')}</div>
    </div>
  )

  // ── CSS tab: inline style + computed summary ────────────────────────────
  const cssTab = styleInfo === null ? (
    <div style={{ fontSize: 11, opacity: 0.6, padding: 8 }}>{t('noSelection')}</div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, fontSize: 11 }}>
      <div style={{ opacity: 0.7 }}>{t('inlineStyle')}</div>
      <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{styleInfo.inlineStyle ?? '—'}</code>
      <div style={{ opacity: 0.7, marginTop: 6 }}>Computed</div>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {cssRows(styleInfo).map(([key, value]) => (
            <tr key={key}>
              <td style={{ padding: '1px 8px 1px 0', opacity: 0.6 }}>{key}</td>
              <td style={{ padding: '1px 0' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

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

      {/* Mode + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="radio" name="es-mode" checked={mode === 'proxy'} onChange={() => changeMode('proxy')} />
          <span>{t('modeProxy')}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="radio" name="es-mode" checked={mode === 'direct'} onChange={() => changeMode('direct')} />
          <span>{t('modeDirect')}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={selecting} disabled={url === undefined} onChange={toggleSelecting} />
          <span>{t('selectMode')}</span>
        </label>
        {mode === 'direct' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', opacity: url === undefined ? 0.5 : 1 }} title={t('sandboxHint')}>
            <input type="checkbox" checked={sandboxed} disabled={url === undefined} onChange={event => setSandboxed(event.target.checked)} />
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
        {selecting && <span style={{ fontSize: 11, opacity: 0.7 }}>{t('selectModeHint')}</span>}
      </div>
      {url !== undefined && mode === 'direct' && !sandboxed && (
        <div style={{ fontSize: 11, borderRadius: 6, padding: '4px 8px', border: '1px solid #e74c3c', color: '#e74c3c' }}>
          {t('sandboxOffWarning')}
        </div>
      )}

      {/* Main split: preview | inspector */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8 }}>
        {/* Preview iframe */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--dsw-border, #3a3f4b)' }}>
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
              onLoad={() => {
                postToProbe({ type: 'dsh-es:ping' })
                postToProbe({ type: 'dsh-es:get-tree' })
              }}
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          )}
          {selecting && (
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              border: '2px dashed #4f8cff', borderRadius: 6, opacity: 0.5,
            }} />
          )}
        </div>

        {/* Inspector */}
        <div style={{
          width: 280, flexShrink: 0, borderRadius: 8, border: '1px solid var(--dsw-border, #3a3f4b)',
          display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--dsw-border, #3a3f4b)' }}>
            <strong style={{ fontSize: 12 }}>{t('inspector')}</strong>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={refreshTree} style={smallButton}>{t('refreshTree')}</button>
            <button type="button" onClick={clearSelection} style={smallButton}>{t('clearSelection')}</button>
          </div>

          {status !== null && <div style={{ fontSize: 11, padding: '4px 8px', opacity: 0.85 }}>{status}</div>}

          {/* Located source + add to conversation */}
          {result !== null && result.ok === true && (
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--dsw-border, #3a3f4b)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                {result.line !== undefined ? `${result.relative}:${result.line}` : result.relative}
              </code>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{t('methodLabel')}: {result.method}</span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={addToChat} style={{ ...smallButton, background: 'rgba(79,140,255,0.18)', borderColor: '#4f8cff' }}>
                  {t('addToChat')}
                </button>
              </div>
            </div>
          )}

          {/* Component tree */}
          <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--dsw-border, #3a3f4b)', minHeight: 0 }}>
            <div style={{ fontSize: 11, opacity: 0.7, padding: '2px 2px 4px' }}>{t('components')}</div>
            <div style={{ overflow: 'auto', maxHeight: 180 }}>
              {tree.length === 0 ? (
                <div style={{ fontSize: 11, opacity: 0.6, padding: 4 }}>{t('noSelection')}</div>
              ) : renderTree(tree, 0)}
            </div>
          </div>

          {/* 设计 / CSS tabs */}
          <div style={{ display: 'flex', gap: 4, padding: '6px 8px 0', borderBottom: '1px solid var(--dsw-border, #3a3f4b)' }}>
            {(['design', 'css'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setInspectorTab(tab)}
                style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid transparent',
                  background: inspectorTab === tab ? 'rgba(127,127,127,0.18)' : 'transparent',
                  color: 'inherit',
                }}
              >
                {t(tab)}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {inspectorTab === 'design' ? designTab : cssTab}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Parse a rotate(...) transform into degrees ('' when absent). */
function rotationDegOf(transform: string | undefined): string {
  if (transform === undefined || transform === 'none') return '0'
  const match = /rotate\(([-\d.]+)deg\)/.exec(transform)
  return match === null ? '0' : match[1]!
}

/** The box-property rows (padding / margin) with per-side inputs. */
function boxFields(
  group: 'padding' | 'margin',
  top: number | undefined,
  right: number | undefined,
  bottom: number | undefined,
  left: number | undefined,
  applyStyle: (patch: Partial<StylePatch>) => void,
  t: (key: string) => string,
): React.ReactNode {
  const commit = (side: 'Top' | 'Right' | 'Bottom' | 'Left') => (value: string): void => {
    applyStyle({
      [`${group}${side}`]: value.trim() === '' ? '' : `${value.trim()}px`,
    } as Partial<StylePatch>)
  }
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>{t(group)}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <NumberField label={t('top')} value={pxOf(top)} unit="px" onCommit={commit('Top')} />
        <NumberField label={t('right')} value={pxOf(right)} unit="px" onCommit={commit('Right')} />
        <NumberField label={t('bottom')} value={pxOf(bottom)} unit="px" onCommit={commit('Bottom')} />
        <NumberField label={t('left')} value={pxOf(left)} unit="px" onCommit={commit('Left')} />
      </div>
    </div>
  )
}

function pxOf(value: number | undefined): string {
  return value === undefined ? '' : String(Math.round(value))
}

/** The computed rows shown on the CSS tab. */
function cssRows(info: StyleInfo): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  const push = (name: string, value: string | number | undefined): void => {
    if (value === undefined || value === '') return
    rows.push([name, String(value)])
  }
  push('display', info.display)
  push('position', info.position)
  push('color', info.color)
  push('background', info.background)
  push('font-size', info.fontSize)
  push('z-index', info.zIndex)
  push('transform', info.transform)
  return rows
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--dsw-border, #3a3f4b)', background: 'transparent', color: 'inherit',
  whiteSpace: 'nowrap',
}

const smallButton: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
  border: '1px solid var(--dsw-border, #3a3f4b)', background: 'transparent', color: 'inherit',
  whiteSpace: 'nowrap',
}
