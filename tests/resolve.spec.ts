import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { candidatePaths, isWithin, resolvePick } from '../src/resolve.ts'
import type { ElementPick } from '../src/protocol.ts'

let dir: string
let cwd: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-es-'))
  cwd = join(dir, 'proj')
  await mkdir(join(cwd, 'src'), { recursive: true })
  await mkdir(join(cwd, 'node_modules'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function pick(partial: Partial<ElementPick>): ElementPick {
  return {
    protocolVersion: 1,
    framework: 'generic',
    element: { tag: 'button', classes: [], attrs: [], selector: 'button' },
    pageUrl: 'http://localhost:5173/',
    ...partial,
  }
}

describe('isWithin', () => {
  it('accepts the root and descendants', () => {
    expect(isWithin('/a/b', '/a/b')).toBe(true)
    expect(isWithin('/a/b', '/a/b/c/d.ts')).toBe(true)
  })

  it('refuses anything above the root and sibling trees', () => {
    expect(isWithin('/a/b', '/a')).toBe(false)
    expect(isWithin('/a/b', '/a/c/d.ts')).toBe(false)
  })
})

describe('candidatePaths', () => {
  it('joins webpack-style project-relative paths onto the cwd', () => {
    const candidates = candidatePaths('/src/App.vue', cwd)
    expect(candidates).toContain(join(cwd, 'src', 'App.vue'))
  })

  it('passes absolute paths through', () => {
    const abs = join(cwd, 'src', 'App.vue')
    const candidates = candidatePaths(abs, cwd)
    expect(candidates[0]).toBe(abs)
  })

  it('strips file:// and a leading slash in front of a Windows drive', () => {
    const candidates = candidatePaths('file:///D:/proj/src/App.vue', cwd)
    expect(candidates[0]).toBe('D:/proj/src/App.vue')
  })

  it('applies prefix mappings before normalization', () => {
    const candidates = candidatePaths('@app/ui/src/Button.tsx', cwd, [
      { find: '@app/ui/src', replacement: join(cwd, 'packages', 'ui') },
    ])
    expect(candidates).toContain(join(cwd, 'packages', 'ui', 'Button.tsx'))
  })
})

describe('resolvePick', () => {
  it('resolves a vue __file (webpack style) and reports vue-file', async () => {
    const file = join(cwd, 'src', 'components', 'Login.vue')
    await mkdir(join(cwd, 'src', 'components'), { recursive: true })
    await writeFile(file, ['<template>', '  <div class="login">', '    <button class="btn">登录</button>', '  </div>', '</template>', ''].join('\n'))
    const result = await resolvePick(pick({
      framework: 'vue',
      source: { file: '/src/components/Login.vue' },
      element: { tag: 'button', classes: ['btn'], attrs: [], selector: 'div > button', text: '登录' },
    }), { cwd })
    if (result.ok !== true) throw new Error('expected ok')
    expect(result.relative).toBe(join('src', 'components', 'Login.vue'))
    expect(result.method).toBe('vue-file')
  })

  it('locates the line inside a __file-only vue file by clicked text', async () => {
    const file = join(cwd, 'src', 'components', 'Card.vue')
    await mkdir(join(cwd, 'src', 'components'), { recursive: true })
    await writeFile(file, ['<template>', '  <div class="card">', '    <span>会员专属</span>', '  </div>', '</template>', ''].join('\n'))
    const result = await resolvePick(pick({
      framework: 'vue',
      source: { file },
      element: { tag: 'span', classes: [], attrs: [], selector: 'div > span', text: '会员专属' },
    }), { cwd })
    if (result.ok !== true) throw new Error('expected ok')
    expect(result.line).toBe(3)
    expect(result.snippet).toContain('会员专属')
  })

  it('keeps an exact react line and column', async () => {
    const file = join(cwd, 'src', 'App.tsx')
    await writeFile(file, ['export function App() {', '  return <div>hi</div>', '}', ''].join('\n'))
    const result = await resolvePick(pick({
      framework: 'react',
      source: { file, line: 2, column: 10 },
    }), { cwd })
    if (result.ok !== true) throw new Error('expected ok')
    expect(result.line).toBe(2)
    expect(result.column).toBe(10)
    expect(result.method).toBe('react-source')
    expect(result.snippet).toContain('<div>hi</div>')
  })

  it('finds a line by clicked text when no source metadata exists', async () => {
    const file = join(cwd, 'src', 'App.vue')
    await writeFile(file, ['<template>', '  <div>', '    <span>欢迎回来</span>', '  </div>', '</template>', ''].join('\n'))
    const result = await resolvePick(pick({
      framework: 'generic',
      element: { tag: 'span', classes: [], attrs: [], selector: 'span', text: '欢迎回来' },
    }), { cwd })
    if (result.ok !== true) throw new Error('expected ok')
    expect(result.relative).toBe(join('src', 'App.vue'))
    expect(result.line).toBe(3)
    expect(result.method).toBe('text-search')
  })

  it('never matches inside node_modules', async () => {
    await writeFile(join(cwd, 'node_modules', 'evil.js'), 'const text = "秘密标记"\n')
    const result = await resolvePick(pick({
      framework: 'generic',
      element: { tag: 'span', classes: [], attrs: [], selector: 'span', text: '秘密标记' },
    }), { cwd })
    expect(result.ok).toBe(false)
  })

  it('refuses a reported source outside the workspace', async () => {
    const outside = join(dir, 'elsewhere', 'file.ts')
    await mkdir(join(dir, 'elsewhere'), { recursive: true })
    await writeFile(outside, 'const x = 1\n')
    const result = await resolvePick(pick({
      framework: 'vue',
      source: { file: outside },
    }), { cwd })
    if (result.ok) throw new Error('expected refusal')
    expect(result.error).toContain('outside the session workspace')
  })

  it('locates a component definition by name as the last resort', async () => {
    const file = join(cwd, 'src', 'LoginButton.tsx')
    await writeFile(file, ['export function LoginButton() {', '  return <button>登录</button>', '}', ''].join('\n'))
    const result = await resolvePick(pick({
      framework: 'react',
      name: 'LoginButton',
      element: { tag: 'button', classes: [], attrs: [], selector: 'button' },
    }), { cwd })
    if (result.ok !== true) throw new Error('expected ok')
    expect(result.relative).toBe(join('src', 'LoginButton.tsx'))
    expect(result.line).toBe(1)
    expect(result.method).toBe('component-search')
  })

  it('fails loudly when nothing matches', async () => {
    const result = await resolvePick(pick({
      framework: 'generic',
      element: { tag: 'div', classes: ['nope'], attrs: [], selector: 'div', text: 'x' },
    }), { cwd })
    expect(result.ok).toBe(false)
  })
})
