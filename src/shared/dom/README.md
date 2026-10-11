# `src/shared/dom`

Small browser-boundary helpers that touch `window`, `document`, `localStorage`,
`sessionStorage`, or DOM types such as `HTMLMediaElement`.

Everything else under `src/shared/` must stay free of those APIs so Node server
code and unit tests can import it safely.

Use `@/client/*` for feature-sized browser packages (realtime, local-media).
Use this folder for cross-cutting storage / DOM utilities shared by components
and client packages.
