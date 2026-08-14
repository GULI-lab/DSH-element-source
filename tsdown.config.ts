/**
 * tsdown config for dsh-element-source.
 *
 * Three artifacts land in lib/:
 *  - index.js    Node half (host plugin), ESM.
 *  - client.js   Browser half, wrapped in the DSH client-modules handoff
 *                (`window.__ModuleLoader__.load({ id, factory })`); react and
 *                the other platform modules stay external and are answered by
 *                the loader's module table at runtime.
 *  - inject.js   Standalone browser probe script (classic <script>, no
 *                imports), served by the host route for dev pages to load.
 *  - vite-plugin.js  Plain plugin for the user's Vite dev server.
 */
import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-element-source'

/** Modules the DSH browser shell shares into the frozen client module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
]

const CLIENT_BUNDLE_WRAPPER = {
  banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
  footer: 'return module.exports; } });',
  intro: 'var module = { exports: {} }; var exports = module.exports;',
}

export default defineConfig([
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    // Emit lib/index.js (the package is "type": "module"), not index.mjs.
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    external: CLIENT_EXTERNALS,
    // Everything that is NOT a platform module must be inlined — a require()
    // the module table cannot answer is a guaranteed runtime throw.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      ...CLIENT_BUNDLE_WRAPPER,
    },
  },
  {
    name: `${PLUGIN_ID}/inject`,
    entry: { inject: 'src/inject/inject.ts' },
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    outputOptions: { entryFileNames: 'inject.js' },
  },
  {
    name: `${PLUGIN_ID}/vite-plugin`,
    entry: { 'vite-plugin': 'vite-plugin/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
