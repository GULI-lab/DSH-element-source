import { describe, expect, it } from 'vitest'
import {
  capText,
  isProbeMessage,
  normalizePreviewUrl,
  pickFromUnknown,
} from '../src/protocol.ts'

describe('normalizePreviewUrl', () => {
  it('allows loopback URLs (the local-preview point)', () => {
    expect(normalizePreviewUrl('localhost:5173').kind).toBe('ok')
    expect(normalizePreviewUrl('http://127.0.0.1:5173/').kind).toBe('ok')
    expect(normalizePreviewUrl('http://192.168.1.10:8080').kind).toBe('ok')
  })

  it('defaults bare hosts to http', () => {
    const result = normalizePreviewUrl('example.com')
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.url).toBe('http://example.com/')
  })

  it('blocks dangerous schemes', () => {
    expect(normalizePreviewUrl('javascript:alert(1)').kind).toBe('blocked')
    expect(normalizePreviewUrl('data:text/html,<h1>x</h1>').kind).toBe('blocked')
    expect(normalizePreviewUrl('file:///etc/passwd').kind).toBe('blocked')
    expect(normalizePreviewUrl('about:blank').kind).toBe('blocked')
  })

  it('rejects empty input', () => {
    expect(normalizePreviewUrl('').kind).toBe('invalid')
    expect(normalizePreviewUrl('   ').kind).toBe('invalid')
  })
})

describe('capText', () => {
  it('caps by code points with an ellipsis', () => {
    expect(capText('abcdef', 3)).toBe('abc…')
    expect(capText('abc', 3)).toBe('abc')
    expect(capText('中文文字', 2)).toBe('中文…')
  })
})

describe('isProbeMessage', () => {
  it('recognizes the probe protocol prefix', () => {
    expect(isProbeMessage({ type: 'dsh-es:pick', pick: {} })).toBe(true)
    expect(isProbeMessage({ type: 'other' })).toBe(false)
    expect(isProbeMessage(null)).toBe(false)
    expect(isProbeMessage('dsh-es:pick')).toBe(false)
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
