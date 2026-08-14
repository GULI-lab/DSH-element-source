/**
 * Build the user-role steering message that wakes the agent after a pick.
 * Pure string assembly so the exact model-visible text is unit-testable.
 */
import type { ElementDescriptor, ResolveMethod } from './protocol.ts'

/** The located-source slice buildSteerText needs. */
export interface LocatedForMessage {
  relative: string
  line?: number
  method: ResolveMethod
}

/** A compact one-line element summary for the message. */
export function elementSummary(element: ElementDescriptor): string {
  let label = element.tag
  if (element.id !== undefined) label += `#${element.id}`
  const classes = element.classes.slice(0, 2)
  if (classes.length > 0) label += `.${classes.join('.')}`
  if (element.text !== undefined && element.text !== '') label += `（文本："${element.text}"）`
  return label
}

const METHOD_LABELS: Record<ResolveMethod, string> = {
  'code-inspector': 'code-inspector data-insp 属性',
  'react-source': 'React dev __source',
  'vue-file': 'Vue __file',
  'svelte-source': 'Svelte dev __svelte_meta',
  'text-search': '工作区文本搜索',
  'component-search': '组件名搜索',
  none: '未知',
}

/**
 * The steering message delivered to the session agent after a successful pick.
 * Bilingual (zh/en) so the model can answer in the user's language.
 */
export function buildSteerText(result: LocatedForMessage, element: ElementDescriptor, pageUrl?: string): string {
  const location = result.line !== undefined ? `${result.relative}:${result.line}` : result.relative
  const label = elementSummary(element)
  const method = METHOD_LABELS[result.method]
  const urlLine = pageUrl === undefined || pageUrl === '' ? '' : `\n页面：${pageUrl}`
  return [
    `[元素定位] 你在预览页面点击了元素 \`${label}\`。`,
    `源代码已定位：\`${location}\`（定位方式：${method}）。${urlLine}`,
    `请用 read 工具读取该文件${result.line !== undefined ? `并定位到第 ${result.line} 行` : ''}，`,
    `在回复中用代码块展示相关源码，用一句话说明该元素渲染了什么，然后等待我的修改需求。`,
    ``,
    `[Element located] You clicked \`${label}\` in the preview page.`,
    `Source: \`${location}\` (method: ${result.method}).`,
    `Read the file with the read tool${result.line !== undefined ? ` and find line ${result.line}` : ''},`,
    `show the relevant code in a code block, explain in one sentence what the element renders, then wait for my change request.`,
  ].join('\n')
}
