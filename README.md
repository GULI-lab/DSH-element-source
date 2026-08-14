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
dev page (one <script> line in index.html, or the Vite plugin injects it)
  └─ inject.js (in-page probe: IIFE, zero deps, runs inside sandboxed iframes)
       hover highlight → click → probe chain (data-insp → React __source → Vue __file → Svelte → Angular → generic)
       → postMessage (cross-origin safe) → DSH page
  └─ better-sidebar "Local preview" tab (registered by this plugin; can open localhost)
       receives postMessage → POST /dsh-element-source/api/resolve
  └─ DSH Host
       ├─ GET  /dsh-element-source/inject.js   (serves the probe script publicly)
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

## Load the probe in your dev page (pick one)

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

1. Open the sidebar → **Local preview** tab;
2. Enter `http://localhost:5173` (your dev server) and press Enter;
3. Tick **Pick mode**;
4. Move the mouse over the preview — the target highlights with live location info; **click** to pick (pick mode auto-exits);
5. The result panel shows `file:line` + the method; one click opens the file in the better-sidebar editor tab or copies the path;
6. By default the agent is woken automatically: an `[Element located]` message lands in the chat, the agent reads the file and shows the code, then waits for your request.

> `Esc` cancels picking. Click **Send to chat** to hand the last pick to the agent manually (when `autoSteer` is off).

## Configuration

Override the row in your `cordis.patch.yml` (or the profile patch):

```yaml
- id: element-source
  config:
    autoSteer: false        # don't wake the agent after a pick; use "Send to chat" instead (default true)
    mappings:               # source-path prefix mappings (monorepo / node_modules rebasing)
      - find: '@app/ui/src'
        replacement: 'D:/workspace/my-app/packages/ui/src'
    sessionId: 'fixed-session'  # pin a session (usually not needed)
```

## Security

- `/dsh-element-source/api/resolve` sits behind the same browser-trust fence as the `/api` gateway (Host header + `trustedHosts`);
- The resolved path **must** fall inside the session workspace (cwd), otherwise it is refused;
- inject.js is read-only: it only collects click metadata and never touches DSH data; the `inject.js` route is public so dev pages can load it cross-origin;
- The preview iframe is sandboxed by default (no `allow-same-origin` / `allow-top-navigation`), same as the built-in browser;
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

- Vue line numbers rely on template-text matching: icon-only / textless elements degrade to file-level (or component-definition) results;
- Angular / Svelte need dev builds — production builds carry no runtime source info;
- The dev page must load the probe script (one line or the Vite plugin); this is forced by the same-origin policy — an iframe's DOM is unreadable from the parent, no iframe approach avoids it;
- "Open in editor" requires better-sidebar's `editor` tab;
- The preview iframe is cross-origin to the sidebar: login state / cookie behavior is as restricted as the built-in browser.

## License

[MIT](LICENSE)
