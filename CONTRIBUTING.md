# Contributing to dsh-element-source

Thanks for wanting to contribute! This project is a small DSH (DeepSeek Harness) plugin, and the bar for contribution is deliberately low.

## How to help

- **Report bugs / request features** — open an [issue](https://github.com/GULI-lab/DSH-element-source/issues). Please include: DSH version, plugin version, framework of the inspected page (Vue/React/Svelte/Angular/other), and what the probe reported (file / line / method) if visible.
- **Code** — fork, branch, implement, test, open a pull request. Keep the PR small and focused.

## Dev setup

```sh
git clone https://github.com/GULI-lab/DSH-element-source
cd dsh-element-source
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

To try a local checkout inside DSH (instead of the published npm package):

```sh
cd ~/.dsh/profiles/web
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add link:/path/to/dsh-element-source
```

Then restart `dsh web` and hard-refresh the browser (Ctrl/Cmd+Shift+R). Client-only changes need a rebuild (`pnpm build` or `pnpm watch`) plus a hard refresh; host-half changes need a `dsh web` restart.

## Before you submit

- Run `pnpm typecheck`, `pnpm test` and `pnpm build` locally — all must pass;
- Add or update tests under `tests/` for behavior changes (the resolve / probes / steer / protocol / preview-proxy / draft suites are pure and fast);
- Keep the README (`README.md` + `README.zh.md`) in sync with user-visible changes;
- Prefer small, self-contained commits with clear messages.

## Code style

- TypeScript, strict mode; ESM (`"type": "module"`);
- Comments state contracts and context, not reasoning transcripts;
- The page probe (`src/inject/`) must stay dependency-free (it runs as a standalone `<script>`);
- Wire protocol types live in `src/protocol.ts` and are shared by all three halves.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
