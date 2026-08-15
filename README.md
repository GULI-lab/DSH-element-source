# dsh-element-source

> Click any UI element in the DSH `dsh-better-sidebar` sidebar to locate its Vue / React / Svelte / Angular source file, and let the chat dialog show the code — so you can fine-tune frontend pages faster.

<p align="center">
  <img src="https://img.shields.io/badge/dsh-plugin-better--sidebar-blue" alt="dsh plugin for better-sidebar" />
  <img src="https://img.shields.io/npm/v/dsh-element-source" alt="npm version" />
  <img src="https://img.shields.io/github/license/YOUR-NAME/dsh-element-source" alt="license" />
</p>

English | [中文](README.zh.md)

## What it does

Finding "that button on the page" ↔ "the line of code that renders it" becomes a single click:

1. Open your frontend page (dev server) in the **Local preview** tab (a better-sidebar tab this plugin registers);
2. Enable **Pick mode**, hover to highlight the target, **click** it;
3. The plugin resolves the matching **source file + line** and injects an `[Element located]` message into the chat;
4. The agent automatically reads the file with the `read` tool and shows the code in the dialog, then waits for your change request.

No build-config changes (beyond a one-line probe script), no browser extension, and it works for Vue / React / Svelte / Angular plus any other framework (generic fallback).

## Framework support

| Framework | File | Line | How |
| --- | --- | --- | --- |
| React (dev build) | ✅ exact | ✅ exact | Reads the JSX `__source` on the fiber (`@vitejs/plugin-react` / CRA inject it; no build change needed) |
| Vue 2 / Vue 3 (dev build) | ✅ exact | ~exact | `__file` gives the file; the line comes from template-text matching |
| Svelte (dev build) | ✅ exact | ✅ exact | Reads dev-mode `__svelte_meta` |
| Angular | best effort | best effort | Detects `ng-reflect-*` markers, then component/text search |
| Any framework + code-inspector-plugin installed | ✅ exact | ✅ exact | Reads its injected `data-insp-*` DOM attributes directly |
| Other / unknown | ✅ | ~ | Full-text search of the session workspace for the clicked text / class / id |

## How it works

```
Two preview modes (switchable in the tab):
  Proxy mode (default, no project changes): GET /dsh-element-source/preview?url=…
      the plugin host fetches the dev page → injects <base href=dev-url> + probe
      + the real-URL marker → serves it from the GUI origin (real origin, so
      localStorage / auth work)
  Direct mode: iframe loads the dev URL as-is (page keeps its own origin;
      requires the probe to be present in the page)

in-page probe (inject.js: IIFE, zero deps, runs inside sandboxed iframes)
  └─ hover highlight → click → probe chain (data-insp → React __source → Vue __file → Svelte → Angular → generic)
     → postMessage (cross-origin safe) → DSH page
better-sidebar "Local preview" tab (registered by this plugin; can open localhost)
  └─ receives postMessage → POST /dsh-element-source/api/resolve
DSH Host
  ├─ GET  /dsh-element-source/inject.js   (serves the probe script publicly)
  ├─ GET  /dsh-element-source/preview     (proxy mode: fetch + inject; loopback hosts only)
  ├─ POST /dsh-element-source/api/resolve (behind the browser-trust fence)
  │     ├─ path normalization (webpack /src, Vite absolute, Windows drives, configurable mappings)
  │     ├─ confinement: the located file MUST stay inside the session cwd
  │     └─ text / component search fallback for the line
  └─ ctx.agents.get(sessionId).steer(located message) → agent reads the file → chat shows it
```

### Why not the built-in browser?

The better-sidebar built-in browser **hard-refuses loopback addresses** (`localhost` / `127.x`) — a deliberate anti-DNS-rebinding design — and frontend dev servers live on localhost. This plugin therefore ships a minimal **Local preview** tab: just an iframe + address bar that CAN open local addresses (no tabs / history — it is not a browser). For **non-loopback** pages (e.g. a dev server bound to a LAN IP), the built-in browser works too — inject.js reports over postMessage regardless of the sandbox.

## Install

**Prereqs**: DSH (`dsh web` runs) and [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (the host sidebar).

**macOS / Linux** (or Windows with Git Bash / WSL):

```sh
curl -fsSL https://raw.githubusercontent.com/YOUR-NAME/dsh-element-source/main/scripts/install.sh | bash
```

**Windows (PowerShell 5.1+ / pwsh)**:

```powershell
irm https://raw.githubusercontent.com/YOUR-NAME/dsh-element-source/main/scripts/install.ps1 | iex
```

Manual install (same flow as better-sidebar):

```sh
cd ~/.dsh/profiles/web
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add dsh-element-source
```

Then **hard-refresh** the browser (Ctrl/Cmd+Shift+R).

## Load the probe in your dev page (direct mode only)

**Proxy mode (the default) needs NO project changes** — the plugin host injects the probe automatically. Only when you switch to **Direct mode** (the page keeps its own origin, e.g. for apps whose data layer uses same-origin relative API calls) does the dev page need to load the probe itself — pick one:

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

1. Open the sidebar → **Local preview** tab (**note: this previews YOUR page, not the DSH UI itself**);
2. **Mode**: **Proxy (no project changes)** is the default — the plugin forwards the page and injects the probe automatically. If your app needs same-origin API calls (relative paths), switch to **Direct** and load the probe as described above;
3. Enter `http://localhost:3000` (your dev server) and press Enter;
4. Watch the **probe status light** turn green (auto in proxy mode; in direct mode the page must already load the probe);
5. Tick **Select mode**, move the mouse — the target highlights; **click** to **persist the selection** (green box stays; click again or `Esc` to clear);
6. The right-hand **inspector** panel:
   - **Located card**: `file:line` + the method; **+ Add to chat** fills the chat input DRAFT (never sends — add your wording and press Enter yourself);
   - **Components**: a bounded DOM tree — click a node to locate and select the element in the page;
   - **Design / CSS**: view and **live-edit** the selected element's width/height, padding, margin and rotation (commit on Enter/blur; edits go to the inline style); the CSS tab shows the inline style and a computed summary.

> `Esc` cancels selection. A selection never sends anything; "Add to chat" fills the composer draft only.

**Two debugging aids:**

- **Probe status light**: the dot in the controls row — green "Probe ready" means the probe is in the page (clicks will work); red "Probe not loaded" means it is not (shouldn't happen in proxy mode; in direct mode add the script line or the Vite plugin).
- **Sandbox toggle** (direct mode only): ON by default (the page is isolated from DSH). If the direct page needs `localStorage` / auth, turn it OFF (page then runs same-origin with DSH — red warning; trusted pages only). Proxy mode is same-origin by design and has no toggle.

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
- **Proxy mode** accepts loopback hosts only (default) and serves the page from the GUI origin — it is for trusted local dev servers; the page's relative API requests hit the DSH origin (the documented trade-off — use direct mode for same-origin data calls);
- inject.js is read-only: it only collects click metadata and never touches DSH data; the `inject.js` route is public so dev pages can load it cross-origin (direct mode);
- The direct-mode iframe is sandboxed by default (no `allow-same-origin` / `allow-top-navigation`), same as the built-in browser;
- `trust-fence.ts` is a behavioral copy of DSH's BSD-3-Clause implementation (attribution in the file header).

## Relation to code-inspector-plugin

[code-inspector](https://github.com/zh-lx/code-inspector) is a **compile-time** approach: a bundler plugin rewrites JSX / SFC compilation to inject `data-insp-*` attributes, and opens your IDE via `launch-ide` on click. This plugin is a **runtime** approach: no build changes, it reads metadata the dev runtime already has, and delivers the location to the **DSH chat and sidebar editor** instead of an external IDE. They complement each other — if code-inspector-plugin is installed, this plugin reads its injected `data-insp-*` attributes for exact positions across all frameworks at zero extra cost.

## Development

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest (resolve / probes / steer / protocol)
pnpm build         # tsc types + tsdown artifacts (lib/index.js, lib/client.js, lib/inject.js, lib/vite-plugin.js)
```

Artifacts: `lib/index.js` (host), `lib/client.js` (browser half, `window.__ModuleLoader__.load` module-table format), `lib/inject.js` (page probe, classic `<script>`, zero deps), `lib/vite-plugin.js` (Vite injection plugin).

## Known limitations

- The Local preview tab targets **your own dev page**: embedding the DSH UI itself (e.g. `http://127.0.0.1:3080`) in the sandboxed iframe does not render — the GUI cannot boot under an opaque origin (localStorage throws, cross-origin bundle fetches are blocked). That is not a plugin bug;
- **Proxy mode** serves the page from the DSH origin: relative-path API calls hit DSH instead of the dev server (apps needing same-origin data calls should use direct mode); pages with a strict CSP (`script-src 'self'`) may block the injected probe;
- Vue line numbers rely on template-text matching: icon-only / textless elements degrade to file-level (or component-definition) results;
- Angular / Svelte need dev builds — production builds carry no runtime source info;
- Direct mode requires the probe in the page (one line or the Vite plugin); this is forced by the same-origin policy — an iframe's DOM is unreadable from the parent, no iframe approach avoids it;
- With the direct-mode sandbox ON the page is an opaque origin: `localStorage` / auth are restricted; turn the sandbox off when you need them (see Usage);
- "Open in editor" requires better-sidebar's `editor` tab.

## License

[MIT](LICENSE)
