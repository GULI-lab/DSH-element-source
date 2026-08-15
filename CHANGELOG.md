# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial open-source release.
- Click-to-source inspector for DSH: preview a local dev server, click an element, and the located `file:line` lands in the DSH chat composer.
- Framework probes: code-inspector `data-insp-*` attributes, React dev `__source` (with component-name fallback for SWC builds), Vue `__file` (v2/v3), Svelte `__svelte_meta`, Angular `ng-reflect-*` markers, generic text/class/id workspace search.
- Zero-project-change proxy preview (`GET /dsh-element-source/preview`) that injects `<base>` + probe and serves the page from the GUI origin (loopback hosts only).
- Dual-mode entry: registers a "Local preview" tab in dsh-better-sidebar when installed; otherwise a right-docked, resizable, collapsible sidebar themed with DSH tokens.
- Persistent element selection with hover preview; picks fill the chat composer draft (never auto-sent); optional `autoSteer` to wake the session agent.
- Optional Vite plugin (`dsh-element-source/vite-plugin`) that auto-injects the probe into dev HTML (`apply: 'serve'` only).
- One-command install scripts for macOS/Linux (`scripts/install.sh`) and Windows PowerShell (`scripts/install.ps1`).
