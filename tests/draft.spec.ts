import { describe, expect, it } from 'vitest'
import { buildDraftText, buildMention, buildReference, insertLocatedSource } from '../src/client/draft.ts'

describe('buildDraftText', () => {
  it('includes the relative file and line', () => {
    expect(buildDraftText({ relative: 'src/App.tsx', line: 42 })).toBe('[元素定位] src/App.tsx:42')
  })

  it('omits the line when unknown', () => {
    expect(buildDraftText({ relative: 'src/App.tsx' })).toBe('[元素定位] src/App.tsx')
  })
})

describe('buildMention', () => {
  it('normalizes Windows separators to the @ menu spelling', () => {
    expect(buildMention('frontend\\src\\NavRail.tsx')).toBe('@frontend/src/NavRail.tsx')
  })

  it('quotes paths with spaces', () => {
    expect(buildMention('src/my file.tsx')).toBe('@"src/my file.tsx"')
  })
})

describe('buildReference', () => {
  it('builds a file reference chip payload', () => {
    expect(buildReference('frontend\\src\\NavRail.tsx', 52)).toEqual({
      source: 'reference',
      ref: '@frontend/src/NavRail.tsx',
      label: 'NavRail.tsx:52',
      appearance: 'file',
      clipboardText: '@frontend/src/NavRail.tsx',
    })
  })
})

describe('insertLocatedSource', () => {
  it('inserts a reference chip through the draft editor', () => {
    const inserted: unknown[] = []
    const ctx = {
      reflect: { get: () => undefined },
      sessions: {
        scope: () => ({
          get: () => ({
            input: {
              for: () => ({
                state: { getSnapshot: () => ({ draft: '' }) },
                setDraft: () => undefined,
                draftEditor: {
                  insertFileReferences: (refs: unknown[]) => { inserted.push(...refs); return true },
                },
              }),
            },
          }),
        }),
      },
    }
    expect(insertLocatedSource(ctx, 'session-x', 'src\\App.tsx', 7)).toBe(true)
    expect(inserted).toHaveLength(1)
    expect((inserted[0] as { label: string }).label).toBe('App.tsx:7')
  })

  it('falls back to plain text when the chip API is absent', () => {
    let written = ''
    const ctx = {
      reflect: { get: () => undefined },
      sessions: {
        scope: () => ({
          get: () => ({
            input: {
              for: () => ({
                state: { getSnapshot: () => ({ draft: '' }) },
                setDraft: (text: string) => { written = text },
              }),
            },
          }),
        }),
      },
    }
    expect(insertLocatedSource(ctx, 'session-x', 'src/App.tsx', 42)).toBe(true)
    expect(written).toBe('[元素定位] src/App.tsx:42')
  })
})
