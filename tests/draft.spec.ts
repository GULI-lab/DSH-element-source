import { describe, expect, it } from 'vitest'
import { buildDraftText } from '../src/client/draft.ts'
import type { ResolveResult } from '../src/protocol.ts'

function result(partial: Partial<ResolveResult>): ResolveResult {
  return {
    ok: true,
    relative: 'src/App.tsx',
    method: 'react-source',
    framework: 'react',
    existed: true,
    steered: false,
    ...partial,
  }
}

describe('buildDraftText', () => {
  it('includes the relative file and line', () => {
    expect(buildDraftText(result({ line: 42 }))).toBe('[元素定位] src/App.tsx:42')
  })

  it('omits the line when unknown', () => {
    expect(buildDraftText(result({}))).toBe('[元素定位] src/App.tsx')
  })
})
