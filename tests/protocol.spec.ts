import { describe, expect, it } from 'vitest'
import { capText, pickFromUnknown } from '../src/protocol.ts'

describe('capText', () => {
  it('caps by code points with an ellipsis', () => {
    expect(capText('abcdef', 3)).toBe('abc…')
    expect(capText('abc', 3)).toBe('abc')
    expect(capText('中文文字', 2)).toBe('中文…')
  })
})

describe('pickFromUnknown', () => {
  it('validates and bounds an untrusted pick payload', () => {
    const pick = pickFromUnknown({
      protocolVersion: 1,
      framework: 'react',
      source: { file: '/src/App.tsx', line: 3, column: 4 },
      name: 'App',
      element: {
        tag: 'div',
        id: 'root',
        classes: ['a', 'b'],
        text: ' hello ',
        selector: 'div#root',
        attrs: [['x', 'y'], ['bad']],
      },
    })
    expect(pick?.framework).toBe('react')
    expect(pick?.source).toEqual({ file: '/src/App.tsx', line: 3, column: 4 })
    expect(pick?.element.classes).toEqual(['a', 'b'])
    expect(pick?.element.attrs).toEqual([['x', 'y']])
  })

  it('rejects payloads without an element object', () => {
    expect(pickFromUnknown({ framework: 'vue' })).toBeUndefined()
    expect(pickFromUnknown(null)).toBeUndefined()
    expect(pickFromUnknown('x')).toBeUndefined()
  })

  it('tolerates a missing source', () => {
    const pick = pickFromUnknown({ element: { tag: 'div' } })
    expect(pick?.framework).toBe('generic')
    expect(pick?.source).toBeUndefined()
    expect(pick?.element.tag).toBe('div')
  })
})
