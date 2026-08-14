/**
 * Optional Vite plugin: auto-injects the dsh-element-source page probe
 * (inject.js) into the dev page's HTML, so you never write a <script> tag by
 * hand. Dev-server only (`apply: 'serve'`); nothing ships into production
 * builds.
 *
 * @example
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { dshElementSourcePlugin } from 'dsh-element-source/vite-plugin'
 *
 * export default defineConfig({
 *   plugins: [dshElementSourcePlugin()],
 * })
 */
/** @typedef {{ dshOrigin?: string, enabled?: boolean }} ElementSourceViteOptions */

const DEFAULT_ORIGIN = 'http://127.0.0.1:3080'

/**
 * Build the Vite plugin.
 * @param {ElementSourceViteOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function dshElementSourcePlugin(options = {}) {
  const { dshOrigin = DEFAULT_ORIGIN, enabled = true } = options
  const origin = String(dshOrigin).replace(/\/+$/, '')
  const src = `${origin}/dsh-element-source/inject.js`
  return {
    name: 'dsh-element-source',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!enabled) return html
      if (html.includes(src)) return html
      const tag = `<script src="${src}"></script>`
      return html.includes('</body>')
        ? html.replace('</body>', `${tag}</body>`)
        : `${html}\n${tag}`
    },
  }
}
