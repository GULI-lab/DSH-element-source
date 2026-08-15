# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report privately by opening a GitHub issue with the "security" label, or contact the maintainers through the repository's [issue tracker](https://github.com/GULI-lab/DSH-element-source/issues) marking the report as sensitive.

Please include:

- Affected version(s) and DSH version;
- Steps to reproduce;
- Impact description and, if you have one, a suggested fix.

## Scope

- `POST /dsh-element-source/api/resolve` and `GET /dsh-element-source/preview` run behind the browser-trust fence and are confined to the session workspace / loopback targets by design — treat any bypass as a bug;
- The page probe (`inject.js`) is read-only metadata collection; it must never read DSH data;
- The preview proxy serves proxied pages from the DSH origin — only ever point it at trusted local dev servers.

## Supported versions

Only the latest published release is actively supported.
