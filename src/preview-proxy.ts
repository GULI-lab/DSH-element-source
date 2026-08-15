/**
 * The zero-modification preview proxy: serve a LOCAL dev page from the GUI
 * origin with the probe script injected, so the page boots with a real origin
 * (localStorage works) and pick-to-source works WITHOUT touching the project.
 *
 * Mechanism:
 *  - Fetch the target HTML server-side and serve it back from the GUI origin.
 *  - Inject `<base href="<target>">` so every relative asset (scripts, CSS,
 *    fonts, url()) still resolves to the dev server — no HTML rewriting.
 *  - Inject the probe script with an ABSOLUTE GUI URL (immune to the base).
 *  - The page's relative API calls now hit the GUI origin and break; that is
 *    the documented trade-off of this mode (load the probe in your own page
 *    instead when the app's data layer needs its own origin).
 *
 * Security: only loopback targets are accepted, the route sits behind the
 * browser-trust fence, and the served page runs same-origin with the GUI —
 * treat proxy mode as "trusted local dev content only".
 */
import type { ElementPick } from './protocol.ts'

/** A preview proxy decision. */
export type PreviewTargetResult =
  | { kind: 'ok'; url: URL }
  | { kind: 'invalid' }
  | { kind: 'blocked'; reason: 'scheme' | 'host' }

/** Scheme whitelist for proxy targets. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/**
 * Validate one proxy target URL: http(s) and a loopback host (or an
 * explicitly allowlisted hostname).
 */
export function sanitizePreviewTarget(raw: string, allowHosts?: readonly string[]): PreviewTargetResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { kind: 'invalid' }
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return { kind: 'blocked', reason: 'scheme' }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!isLoopback(hostname) && !(allowHosts ?? []).includes(hostname)) {
    return { kind: 'blocked', reason: 'host' }
  }
  return { kind: 'ok', url }
}

/** Whether a hostname names a loopback address (localhost / 127.x / ::1). */
export function isLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** The base href for the proxied document (final URL, query/hash stripped). */
export function baseHrefOf(url: URL): string {
  const base = new URL(url)
  base.hash = ''
  base.search = ''
  return base.href.endsWith('/') ? base.href : `${base.href}/`
}

/**
 * Build the proxied HTML document:
 *  - `<base>` so the page's own relative assets keep resolving to the dev
 *    server;
 *  - a `history.replaceState` restore so SPA routers see the ORIGINAL dev
 *    path (the proxied document's own pathname would otherwise be
 *    `/dsh-element-source/preview?...` and match no route → blank view). The
 *    restore MUST use a full same-origin URL: pushState/replaceState resolve
 *    their argument against `<base>`, which points at the (cross-origin) dev
 *    server, so a bare path would throw a SecurityError.
 *  - a `pushState`/`replaceState` wrapper: SPA routers navigate with
 *    `pushState('/route')`, which would also resolve against `<base>` into
 *    the cross-origin dev server and throw. The wrapper re-resolves such
 *    URLs against the GUI origin so in-app navigation keeps working;
 *  - the probe script (absolute GUI URL, immune to the base);
 *  - the real target URL for the probe's pageUrl.
 */
export function buildPreviewDocument(
  html: string,
  targetUrl: URL,
  injectScriptUrl: string,
  originalTarget = '',
): string {
  if (html.includes(injectScriptUrl)) return html
  const base = `<base href="${escapeHtmlAttribute(baseHrefOf(targetUrl))}">`
  const probe = `<script src="${escapeHtmlAttribute(injectScriptUrl)}"></script>`
  const guiOrigin = new URL(injectScriptUrl).origin
  const restorePath = `${targetUrl.pathname}${targetUrl.search}`
  const targetMeta = originalTarget === ''
    ? ''
    : `<script>window.__DSH_ES_TARGET__=${JSON.stringify(originalTarget)};</script>`
  const restore = `<script>try{history.replaceState(null,'',${JSON.stringify(`${guiOrigin}${restorePath}`)})}catch(e){}</script>`
  const historyGuard = `<script>(function(){function f(n){var o=History.prototype[n];History.prototype[n]=function(s,t,u){if(u==null)return o.apply(this,arguments);var x;try{x=new URL(String(u),document.baseURI)}catch(e){return o.apply(this,arguments)}if(x.origin===location.origin)return o.apply(this,arguments);return o.call(this,s,t,location.origin+x.pathname+x.search+x.hash)}}f('pushState');f('replaceState')})();</script>`
  const injected = `${base}${targetMeta}${restore}${historyGuard}${probe}`
  const headMatch = /<head([^>]*)>/i.exec(html)
  if (headMatch !== null) {
    const at = headMatch.index + headMatch[0].length
    return html.slice(0, at) + injected + html.slice(at)
  }
  // No <head>: prepend the injection to the document.
  const doctype = /^<!DOCTYPE[^>]*>/i.exec(html)
  if (doctype !== null) {
    return html.slice(0, doctype[0].length) + injected + html.slice(doctype[0].length)
  }
  return injected + html
}

/** Escape a string for safe use inside a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** The page URL the probe reports: the real target when known, else the proxied URL. */
export function probePageUrlOf(record: Record<string, unknown>, fallback: string): string {
  const target = record.__DSH_ES_TARGET__
  return typeof target === 'string' && target !== '' ? target : fallback
}

/** The element pick's pageUrl, preferring the real target the proxy set. */
export function pickPageUrl(pick: ElementPick, fallback: string): string {
  return pick.pageUrl !== '' && pick.pageUrl !== fallback ? pick.pageUrl : fallback
}
