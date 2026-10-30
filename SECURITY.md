# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report privately by opening a GitHub issue with the "security" label, or contact the maintainers through the repository's [issue tracker](https://github.com/GULI-lab/DSH-element-source/issues) marking the report as sensitive.

Please include:

- Affected version(s) and DSH version;
- Steps to reproduce;
- Impact description and, if you have one, a suggested fix.

## Scope

- `GET /dsh-element-source/api/pending` runs behind the browser-trust fence, requires a real session, and resolves files only inside that session's workspace — treat any bypass as a bug;
- `POST /dsh-element-source/api/pick` is intentionally public and CORS-open because the page runs in an isolated built-in-browser webview. It is write-only, bounded (32 queued picks), and never returns pick data;
- The page probe (`inject.js`) is read-only metadata collection; it must never read DSH data;
- Source-path mappings may rebase a path but must not escape the session workspace;
- The plugin ships no preview proxy and never fetches arbitrary page URLs.

## Supported versions

Only the latest published release is actively supported.
