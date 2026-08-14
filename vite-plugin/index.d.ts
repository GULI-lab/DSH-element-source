/**
 * Type declarations for `dsh-element-source/vite-plugin` (hand-written; the
 * plugin source is plain JavaScript so it needs no build step of its own).
 */

/** Options for {@link dshElementSourcePlugin}. */
export interface ElementSourceViteOptions {
  /**
   * The DSH GUI origin that serves `/dsh-element-source/inject.js`.
   * Default `http://127.0.0.1:3080`.
   */
  dshOrigin?: string
  /**
   * Set false to disable injection entirely (the hook then returns the HTML
   * unchanged). Default true.
   */
  enabled?: boolean
}

/** A structurally compatible Vite plugin (avoids a hard `vite` type import). */
export interface ElementSourceVitePluginLike {
  name: string
  apply: 'serve'
  transformIndexHtml(html: string): string
}

/** Build the Vite plugin that injects the probe script into dev HTML. */
export function dshElementSourcePlugin(options?: ElementSourceViteOptions): ElementSourceVitePluginLike
