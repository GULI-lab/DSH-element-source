import { describe, expect, it } from 'vitest'
import { buildSteerText, elementSummary, type LocatedForMessage } from '../src/steer.ts'

function result(partial: Partial<LocatedForMessage>): LocatedForMessage {
  return {
    relative: 'src/components/Login.vue',
    line: 42,
    method: 'vue-file',
    ...partial,
  }
}

describe('elementSummary', () => {
  it('renders tag, id, classes and text', () => {
    expect(elementSummary({
      tag: 'button',
      id: 'login',
      classes: ['btn', 'btn-primary'],
      attrs: [],
      selector: 'button#login',
      text: '登录',
    })).toBe('button#login.btn.btn-primary（文本："登录"）')
  })

  it('omits missing parts', () => {
    expect(elementSummary({ tag: 'div', classes: [], attrs: [], selector: 'div' })).toBe('div')
  })
})

describe('buildSteerText', () => {
  it('contains the relative location, line, and a read instruction', () => {
    const text = buildSteerText(
      result({}),
      { tag: 'button', classes: [], attrs: [], selector: 'button' },
      'http://localhost:5173/',
    )
    expect(text).toContain('[元素定位]')
    expect(text).toContain('src/components/Login.vue:42')
    expect(text).toContain('read 工具')
    expect(text).toContain('http://localhost:5173/')
  })

  it('mentions only the file when there is no line', () => {
    const text = buildSteerText(
      result({ line: undefined, relative: 'src/index.ts' }),
      { tag: 'div', classes: [], attrs: [], selector: 'div' },
    )
    expect(text).toContain('src/index.ts')
    expect(text).not.toContain('src/index.ts:')
  })
})
