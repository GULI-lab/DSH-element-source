# dsh-element-source

> Click any UI element in your running dev page to jump to its Vue / React / Svelte / Angular source. A click-to-source inspector for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH), compatible with [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar): preview local dev servers, pick an element, and the source location lands in the DSH chat for the agent to tweak.

<p align="center">
  <img src="https://img.shields.io/badge/dsh--plugin--better--sidebar-blue" alt="dsh plugin, dsh-better-sidebar compatible" />
  <img src="https://img.shields.io/npm/v/dsh-element-source" alt="npm version" />
  <img src="https://img.shields.io/github/license/GULI-lab/DSH-element-source" alt="license" />
</p>

English | [中文](README.zh.md)

## What it does

Finding "that button on the page" ↔ "the line of code that renders it" becomes a single click:

1. Open your frontend page (dev server) in the **Local preview** entry — a tab this plugin registers in dsh-better-sidebar, or its own right-docked sidebar when the sidebar is not installed;
2. Enable **Pick mode**, hover to highlight the target, **click** it;
3. The plugin resolves the matching **source file + line** and fills the chat composer with an `[元素定位]` message (nothing is sent — you decide);
4. The agent reads the file with the `read` tool, shows the code in the dialog, and waits for your change request.

No browser extension required, and it works for Vue / React / Svelte / Angular plus any other framework (generic fallback).

## Framework support

| Framework | File | Line | How |
| --- | --- | --- | --- |
| React (dev build) | ✅ exact | ✅ exact | Reads the JSX `__source` on the fiber (`@vitejs/plugin-react` / CRA inject it) |
| Vue 2 / Vue 3 (dev build) | ✅ exact | ~exact | `__file` gives the file; the line comes from template-text matching |
| Svelte (dev build) | ✅ exact | ✅ exact | Reads dev-mode `__svelte_meta` |
| Angular | best effort | best effort | Detects `ng-reflect-*` markers, then component/text search |
| Any framework + code-inspector-plugin installed | ✅ exact | ✅ exact | Reads its injected `data-insp-*` DOM attributes directly |
| Other / unknown | ✅ | ~ | Full-text search of the session workspace for the clicked text / class / id |

## How it works

```
Proxy mode: GET /dsh-element-source/preview?url=…
  the plugin host fetches the dev page → injects <base href=dev-url> + probe
  + the real-URL marker → serves it from the GUI origin (real origin, so
  localStorage / auth work, and the probe is ready automatically)

in-page probe (inject.js: IIFE, zero deps)
  └─ hover highlight → click → probe chain (data-insp → React __source → Vue __file → Svelte → Angular → generic)
     → postMessage (cross-origin safe) → DSH page
"Local preview" entry (registered by this plugin; can open localhost)
  ├─ dsh-better-sidebar installed → its "Local preview" tab (preferred entry)
  └─ otherwise → a right-docked sidebar (full-height, collapsible to an edge
     strip) bound to the current session
  └─ receives postMessage → POST /dsh-element-source/api/resolve
DSH Host
  ├─ GET  /dsh-element-source/inject.js   (serves the probe script publicly)
  ├─ GET  /dsh-element-source/preview     (fetch + inject; loopback hosts only)
  ├─ POST /dsh-element-source/api/resolve (behind the browser-trust fence)
  │     ├─ path normalization (webpack /src, Vite absolute, Windows drives, configurable mappings)
  │     ├─ confinement: the located file MUST stay inside the session cwd
  │     └─ text / component search fallback for the line
  └─ the located source fills the chat composer draft (never sent); you send it
```

### dsh-better-sidebar compatibility

This plugin does **not** depend on dsh-better-sidebar, but is fully compatible with it: with the sidebar installed the entry is its **Local preview** tab (the standalone right sidebar is suppressed, so the two UIs never overlap); without it, a full-height right sidebar (collapsible to an edge strip) hosts the panel, themed with the DSH tokens so it follows the GUI theme. Routes (`/sidebar/*` vs `/dsh-element-source/*`), postMessage namespaces and UI slots are completely disjoint, so the two plugins coexist without conflict.

### A dedicated Local preview tab

Frontend dev servers usually run on `localhost`, so this plugin ships a minimal **Local preview** tab — just an iframe + address bar that can open local (loopback) addresses directly (it is not a browser: no tabs / history). The page is proxied through the DSH origin with the probe auto-injected, so the probe is ready automatically. For **non-loopback** pages (e.g. a dev server bound to a LAN IP), the sidebar's built-in browser or a regular browser tab works too — the probe reports over postMessage regardless of the sandbox.

## Install

**Prereqs**: DSH (`dsh web` runs). **Optional**: [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — with it the entry is the sidebar's "Local preview" tab; without it, a full-height right sidebar hosts the panel.

**macOS / Linux** (or Windows with Git Bash / WSL):

```sh
curl -fsSL https://raw.githubusercontent.com/GULI-lab/DSH-element-source/main/scripts/install.sh | bash
```

**Windows (PowerShell 5.1+ / pwsh)**:

```powershell
irm https://raw.githubusercontent.com/GULI-lab/DSH-element-source/main/scripts/install.ps1 | iex
```

Manual install (same flow as dsh-better-sidebar):

```sh
cd ~/.dsh/profiles/web
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add dsh-element-source
```

Then **hard-refresh** the browser (Ctrl/Cmd+Shift+R).

## Loading the probe in your own page (optional)

The **Local preview** tab's proxy mode injects the probe automatically. Loading the probe in your own page is only needed when you inspect with a browser other than this tab (e.g. the built-in sidebar browser for non-loopback URLs) — pick one:

**Option A — one script line.** Add to your `index.html` `<body>`:

```html
<script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>
```

(`3080` = your DSH Web UI port; a LAN IP works too for remote devices.)

**Option B — Vite plugin** (works for Vue / React / Svelte / Angular Vite projects):

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { dshElementSourcePlugin } from 'dsh-element-source/vite-plugin'

export default defineConfig({
  plugins: [dshElementSourcePlugin(), /* your other plugins */],
})
```

The plugin only injects in dev (`apply: 'serve'`); production builds are untouched. If DSH is not on the default address:

```ts
dshElementSourcePlugin({ dshOrigin: 'http://192.168.1.5:3080' })
```

## Usage

1. **Open the entry**: with better-sidebar → its **Local preview** tab; without it → the right-docked sidebar (open by default; collapsible to an edge strip) (**note: this previews YOUR page, not the DSH UI itself**);
2. Enter `http://localhost:3000` (your dev server) and press Enter;
3. Watch the **probe status icon** (wifi) turn green — ready automatically in proxy mode;
4. Click the **select** icon (crosshair), move the mouse — the target highlights; **click** to locate the source;
5. The panel shows the location: `file:line` and the source snippet;
6. **The pick fills the chat input DRAFT automatically** (e.g. `[元素定位] src/components/App.vue:12`) — nothing is sent; add your own wording and press Enter.

> `Esc` cancels selection. A pick only fills the composer draft; whether to send is entirely your call.

The toolbar also has **refresh** (reload the page) and **open externally** (real browser tab).

## Configuration

Override the row in your `cordis.patch.yml` (or the profile patch):

```yaml
- id: element-source
  config:
    autoSteer: false        # wake the agent right after a pick (default false: only fill the chat draft)
    mappings:               # source-path prefix mappings (monorepo / node_modules rebasing)
      - find: '@app/ui/src'
        replacement: 'D:/workspace/my-app/packages/ui/src'
    proxyHosts:             # extra hosts the preview proxy may fetch (default: loopback only)
      - '192.168.1.10'
    sessionId: 'fixed-session'  # pin a session (usually not needed)
```

## Security

- `/dsh-element-source/api/resolve` and `/dsh-element-source/preview` sit behind the same browser-trust fence as the `/api` gateway (Host header + `trustedHosts`);
- The resolved path **must** fall inside the session workspace (cwd), otherwise it is refused;
- The preview accepts loopback hosts only (default) and serves the page from the GUI origin — it is for trusted local dev servers; the page's relative API requests hit the DSH origin (the documented trade-off — for same-origin data calls, load the probe in your own page);
- inject.js is read-only: it only collects click metadata and never touches DSH data; the `inject.js` route is public so dev pages can load it cross-origin;
- `trust-fence.ts` is a behavioral copy of DSH's BSD-3-Clause implementation (attribution in the file header).

## Relation to code-inspector-plugin

[code-inspector](https://github.com/zh-lx/code-inspector) is a **compile-time** approach: a bundler plugin rewrites JSX / SFC compilation to inject `data-insp-*` attributes, and opens your IDE via `launch-ide` on click. This plugin is a **runtime** approach: it reads metadata the dev runtime already has and delivers the location to the **DSH chat** instead of an external IDE. They complement each other — if code-inspector-plugin is installed, this plugin reads its injected `data-insp-*` attributes for exact positions across all frameworks at zero extra cost.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the dev environment and submit changes. Found a bug or have an idea? Open an [issue](https://github.com/GULI-lab/DSH-element-source/issues).

## Development

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest (resolve / probes / steer / protocol / preview-proxy / draft)
pnpm build         # tsc types + tsdown artifacts (lib/index.js, lib/client.js, lib/inject.js, lib/vite-plugin.js)
```

Artifacts: `lib/index.js` (host), `lib/client.js` (browser half, `window.__ModuleLoader__.load` module-table format), `lib/inject.js` (page probe, classic `<script>`, zero deps), `lib/vite-plugin.js` (Vite injection plugin).

To try a local checkout in DSH before the npm release:

```sh
git clone https://github.com/GULI-lab/DSH-element-source
cd ~/.dsh/profiles/web
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add link:/path/to/DSH-element-source
```

## Known limitations

- The Local preview tab targets **your own dev page**: embedding the DSH UI itself (e.g. `http://127.0.0.1:3080`) in the preview iframe does not render — the GUI cannot boot as a proxied page. That is not a plugin bug;
- The preview serves the page from the DSH origin: relative-path API calls hit DSH instead of the dev server (for same-origin data calls, load the probe in your own page); pages with a strict CSP (`script-src 'self'`) may block the injected probe;
- Vue line numbers rely on template-text matching: icon-only / textless elements degrade to file-level (or component-definition) results;
- Angular / Svelte need dev builds — production builds carry no runtime source info;
- Inspecting with a browser other than the Local preview tab (non-loopback URLs) requires the page to load the probe itself (one line or the Vite plugin); this is forced by the same-origin policy — an iframe's DOM is unreadable from the parent, no iframe approach avoids it.

## License

[MIT](LICENSE) © dsh-element-source contributors
