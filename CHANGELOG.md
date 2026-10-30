# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-30

### Changed (breaking)

- **Rebuilt around the DSH built-in browser.** The plugin now injects its probe directly into the desktop app's Electron `<webview>` pages and appends a select-element control to the **browser's own toolbar** (last item, right of the open-external button). The toolbar control is shown only on development pages and removed again when the page stops being one.
- **dsh-better-sidebar is no longer supported.** The integration, the "Local preview" tab, the fallback right-docked sidebar and the competing entry slot are removed. Install into the `desktop` profile; the one-command installers now default to `desktop`.
- **Picker interaction redesigned.** The picker starts enabled; hovering an element shows a dashed outline plus an **「添加到对话」** pill outside the element's lower-right corner. While picking, ordinary page clicks and the context menu are neutralized (no navigation, no theme toggle, no submit) and **only the pill picks**, so a click intended as a selection can never operate the page. The toolbar icon and `Esc` toggle the picker.
- **A pick now becomes a file reference chip** in the composer (same `@path` semantics as the built-in `@` file menu), with the line in its label (e.g. `LoginPage.tsx:90`). The plain `[元素定位] …` text remains only as a fallback.

### Added

- **Chip click opens the built-in preview at the located line** (via the sidebar document preview's line parameter), instead of opening the file at the top.
- Resolution budget (2.5 s) and a 60 s result cache, plus 300 ms polling, so picks stay responsive in large monorepos.
- The picker control is removed from pages that are not development builds, so a plain page never shows a misleading picker button.

### Fixed

- React picks crashed with `TypeError: Cannot read properties of null (reading 'displayName')` on text/host fibers (`elementType`/`type` are `null`); picks on real React pages failed silently. Added a regression test.
- Probe re-injection after a same-URL page reload (client no longer dedupes by URL).
- The toolbar switch's click handler captured its first state and stopped toggling after the first click.
- Session ids are accepted with and without the `session-` prefix when resolved against the host store.
- The picker pill no longer chases the pointer and no longer covers the element's content.

## [0.1.1] - 2026-10-30

### Fixed

- Compatibility with DSH 0.2.x: the `@deepseek-ai/dsh-*` peer ranges now accept `0.1.x` and `0.2.x` (`>=0.1.0-rc.6 <0.3.0`), and `engines.dsh` declares the supported host line explicitly, so the 0.2.1-rc.5 host no longer refuses the plugin as incompatible. Verified against `@deepseek-ai/dsh-llm@0.2.1-rc.5` (`/message` export and `createUserMessage` unchanged) and `@deepseek-ai/cordis@4.0.5`.

## [0.1.0] - 2026-08-15

### Added

- Initial open-source release.
- Click-to-source inspector for DSH: preview a local dev server, click an element, and the located `file:line` lands in the DSH chat composer.
- Framework probes: code-inspector `data-insp-*` attributes, React dev `__source` (with component-name fallback for SWC builds), Vue `__file` (v2/v3), Svelte `__svelte_meta`, Angular `ng-reflect-*` markers, generic text/class/id workspace search.
- Zero-project-change proxy preview (`GET /dsh-element-source/preview`) that injects `<base>` + probe and serves the page from the GUI origin (loopback hosts only).
- Dual-mode entry: registers a "Local preview" tab in dsh-better-sidebar when installed; otherwise a right-docked, resizable, collapsible sidebar themed with DSH tokens.
- Persistent element selection with hover preview; picks fill the chat composer draft (never auto-sent); optional `autoSteer` to wake the session agent.
- Optional Vite plugin (`dsh-element-source/vite-plugin`) that auto-injects the probe into dev HTML (`apply: 'serve'` only).
- One-command install scripts for macOS/Linux (`scripts/install.sh`) and Windows PowerShell (`scripts/install.ps1`).
