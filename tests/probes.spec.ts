import { describe, expect, it } from 'vitest'
import {
  bestProbeResult,
  describeElement,
  probeAngular,
  probeChain,
  probeCodeInspector,
  probeReact,
  probeSvelte,
  probeVue,
  type ProbeElement,
} from '../src/inject/probes.ts'

/** Build a fake DOM-like node for the probes. */
function node(partial: Partial<ProbeElement> & { tagName?: string }): ProbeElement {
  const base: ProbeElement = {
    tagName: partial.tagName ?? 'div',
    parentElement: null,
    attributes: [],
    textContent: '',
  }
  const el: ProbeElement = { ...base, ...partial }
  el.getAttribute = (name: string): string | null => {
    const attrs = el.attributes
    if (Array.isArray(attrs)) {
      const row = attrs.find(item => item.name === name)
      return row === undefined ? null : row.value
    }
    return null
  }
  return el
}

function attrs(rows: Array<[string, string]>): Array<{ name: string; value: string }> {
  return rows.map(([name, value]) => ({ name, value }))
}

describe('probeCodeInspector', () => {
  it('reads data-insp-* attributes exactly', () => {
    const el = node({
      attributes: attrs([['data-insp-path', '/src/App.vue'], ['data-insp-row', '7'], ['data-insp-col', '3']]),
    })
    const result = probeCodeInspector(el)
    expect(result).toEqual({
      framework: 'code-inspector',
      source: { file: '/src/App.vue', line: 7, column: 3 },
    })
  })

  it('returns null without the marker', () => {
    expect(probeCodeInspector(node({}))).toBeNull()
  })
})

describe('probeReact', () => {
  it('reads __source off the nearest fiber memoizedProps', () => {
    const inner: Record<string, unknown> = {
      memoizedProps: { className: 'x' },
      return: null,
    }
    const fiber: Record<string, unknown> = {
      elementType: { displayName: 'LoginButton' },
      memoizedProps: { __source: { fileName: '/src/LoginButton.tsx', lineNumber: 12, columnNumber: 5 } },
      return: inner,
    }
    const el = node({ ['__reactFiber$abc']: fiber })
    const result = probeReact(el)
    expect(result).toEqual({
      framework: 'react',
      name: 'LoginButton',
      source: { file: '/src/LoginButton.tsx', line: 12, column: 6 },
    })
  })

  it('walks up the fiber chain to find __source', () => {
    const leaf: Record<string, unknown> = { memoizedProps: { children: 'x' }, return: null }
    const parent: Record<string, unknown> = {
      type: { name: 'Card' },
      memoizedProps: { __source: { fileName: '/src/Card.tsx', lineNumber: 4, columnNumber: 1 } },
      return: leaf,
    }
    const el = node({ ['__reactInternalInstance$xyz']: parent })
    const result = probeReact(el)
    expect(result?.framework).toBe('react')
    expect(result?.source).toEqual({ file: '/src/Card.tsx', line: 4, column: 2 })
    expect(result?.name).toBe('Card')
  })

  it('returns null without a react fiber', () => {
    expect(probeReact(node({}))).toBeNull()
  })

  it('reports the component name without __source (SWC-style compilers)', () => {
    const component: Record<string, unknown> = { type: { name: 'ChatPanel' }, memoizedProps: { children: 'x' }, return: null }
    const host: Record<string, unknown> = { type: 'div', memoizedProps: { className: 'x' }, return: component }
    const el = node({ ['__reactFiber$swc']: host })
    const result = probeReact(el)
    expect(result).toEqual({ framework: 'react', name: 'ChatPanel' })
    expect(result?.source).toBeUndefined()
  })
})

describe('probeVue', () => {
  it('reads __file from a Vue 3 parent component', () => {
    const el = node({
      __vueParentComponent: { type: { __file: '/src/components/Login.vue', __name: 'Login' } },
    })
    const result = probeVue(el)
    expect(result).toEqual({
      framework: 'vue',
      name: 'Login',
      source: { file: '/src/components/Login.vue' },
    })
  })

  it('reads __file from a Vue 2 instance options', () => {
    const el = node({ __vue__: { $options: { __file: '/src/App.vue' } } })
    const result = probeVue(el)
    expect(result?.framework).toBe('vue')
    expect(result?.source?.file).toBe('/src/App.vue')
  })

  it('walks ancestors to find the owning component', () => {
    const leaf = node({ tagName: 'span' })
    const parent = node({ tagName: 'div', __vueParentComponent: { type: { __file: '/src/Card.vue' } } })
    leaf.parentElement = parent
    expect(probeVue(leaf)?.source?.file).toBe('/src/Card.vue')
  })

  it('returns null without vue markers', () => {
    expect(probeVue(node({}))).toBeNull()
  })
})

describe('probeSvelte', () => {
  it('reads __svelte_meta.loc', () => {
    const el = node({ __svelte_meta: { loc: { file: '/src/App.svelte', line: 9, column: 2 } } })
    const result = probeSvelte(el)
    expect(result).toEqual({
      framework: 'svelte',
      source: { file: '/src/App.svelte', line: 9, column: 2 },
    })
  })

  it('returns null without svelte meta', () => {
    expect(probeSvelte(node({}))).toBeNull()
  })
})

describe('probeAngular', () => {
  it('detects ng-reflect markers', () => {
    const el = node({ attributes: attrs([['ng-reflect-ng-if', 'true']]) })
    expect(probeAngular(el)?.framework).toBe('angular')
  })

  it('detects __ngContext__', () => {
    const el = node({ __ngContext__: {} })
    expect(probeAngular(el)?.framework).toBe('angular')
  })

  it('returns null without angular markers', () => {
    expect(probeAngular(node({}))).toBeNull()
  })
})

describe('probeChain / bestProbeResult', () => {
  it('picks the deepest exact source over a shallower file-only one', () => {
    const leaf = node({
      tagName: 'span',
      attributes: attrs([['data-insp-path', '/src/A.vue'], ['data-insp-row', '3']]),
    })
    const parent = node({
      tagName: 'div',
      attributes: attrs([['data-insp-path', '/src/A.vue'], ['data-insp-row', '9']]),
    })
    leaf.parentElement = parent
    const chain = probeChain(leaf)
    const best = bestProbeResult(chain)
    expect(best?.source?.line).toBe(3)
    expect(chain[0]?.result.framework).toBe('code-inspector')
  })

  it('falls back to the first framework hit without source', () => {
    const el = node({ __ngContext__: {} })
    const chain = probeChain(el)
    const best = bestProbeResult(chain)
    expect(best?.framework).toBe('angular')
    expect(best?.source).toBeUndefined()
  })
})

describe('describeElement', () => {
  it('builds a bounded descriptor', () => {
    const el = node({
      tagName: 'BUTTON',
      id: 'login',
      className: 'btn btn-primary',
      textContent: '  登录  ',
      attributes: attrs([['type', 'submit'], ['data-x', 'value-with-very-long-tail']]),
    })
    const descriptor = describeElement(el)
    expect(descriptor.tag).toBe('button')
    expect(descriptor.id).toBe('login')
    expect(descriptor.classes).toEqual(['btn', 'btn-primary'])
    expect(descriptor.text).toBe('登录')
    expect(descriptor.attrs).toContainEqual(['type', 'submit'])
  })

  it('caps attribute values', () => {
    const el = node({
      tagName: 'div',
      attributes: attrs([['data-long', 'a'.repeat(200)]]),
    })
    const descriptor = describeElement(el)
    const value = descriptor.attrs[0]?.[1]
    expect(value?.endsWith('…')).toBe(true)
    expect(Array.from(value ?? '').length).toBeLessThanOrEqual(41)
  })
})
