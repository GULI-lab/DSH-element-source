import { describe, expect, it } from 'vitest'
import {
  baseHrefOf,
  buildPreviewDocument,
  escapeHtmlAttribute,
  isLoopback,
  sanitizePreviewTarget,
} from '../src/preview-proxy.ts'

describe('sanitizePreviewTarget', () => {
  it('accepts loopback http(s) targets', () => {
    expect(sanitizePreviewTarget('http://localhost:5173/').kind).toBe('ok')
    expect(sanitizePreviewTarget('http://127.0.0.1:3000/').kind).toBe('ok')
    expect(sanitizePreviewTarget('https://localhost:8443/x').kind).toBe('ok')
  })

  it('refuses non-loopback hosts and non-http schemes', () => {
    expect(sanitizePreviewTarget('http://example.com/').kind).toBe('blocked')
    expect(sanitizePreviewTarget('file:///etc/passwd').kind).toBe('blocked')
    expect(sanitizePreviewTarget('javascript:alert(1)').kind).toBe('blocked')
    expect(sanitizePreviewTarget('not a url').kind).toBe('invalid')
  })

  it('honors an explicit host allowlist', () => {
    const result = sanitizePreviewTarget('http://example.com/', ['example.com'])
    expect(result.kind).toBe('ok')
  })
})

describe('isLoopback', () => {
  it('detects the loopback family', () => {
    expect(isLoopback('localhost')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('0.0.0.0')).toBe(true)
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('127.8.8.8')).toBe(true)
    expect(isLoopback('192.168.1.5')).toBe(false)
    expect(isLoopback('example.com')).toBe(false)
  })
})

describe('baseHrefOf', () => {
  it('normalizes to a trailing-slash directory URL', () => {
    expect(baseHrefOf(new URL('http://localhost:5173/'))).toBe('http://localhost:5173/')
    expect(baseHrefOf(new URL('http://localhost:5173/app'))).toBe('http://localhost:5173/app/')
    expect(baseHrefOf(new URL('http://localhost:5173/app?x=1#frag'))).toBe('http://localhost:5173/app/')
  })
})

describe('buildPreviewDocument', () => {
  const target = new URL('http://localhost:5173/')
  const inject = 'http://127.0.0.1:3080/dsh-element-source/inject.js'

  it('injects base + probe right after <head>', () => {
    const html = '<!DOCTYPE html>\n<html><head><title>x</title></head><body></body></html>'
    const out = buildPreviewDocument(html, target, inject, target.href)
    expect(out).toContain('<base href="http://localhost:5173/">')
    expect(out).toContain('<script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>')
    expect(out).toContain('window.__DSH_ES_TARGET__')
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'))
  })

  it('falls back to prepending when there is no <head>', () => {
    const out = buildPreviewDocument('<body><h1>hi</h1></body>', target, inject)
    expect(out.startsWith('<base href=')).toBe(true)
    expect(out).toContain('<h1>hi</h1>')
  })

  it('is idempotent when the probe is already present', () => {
    const html = `<head><script src="${inject}"></script></head>`
    const out = buildPreviewDocument(html, target, inject)
    expect(out).toBe(html)
  })

  it('omits the target meta when no original target is given', () => {
    const out = buildPreviewDocument('<head></head>', target, inject)
    expect(out).not.toContain('__DSH_ES_TARGET__')
  })

  it('escapes attribute values', () => {
    expect(escapeHtmlAttribute('http://x/?a="b"&c=<d>')).toBe('http://x/?a=&quot;b&quot;&amp;c=&lt;d&gt;')
  })
})
