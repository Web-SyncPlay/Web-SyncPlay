# `src/shared/dom`

Browser-boundary helpers that touch `window`, `document`, `localStorage`,
`sessionStorage`, or DOM types such as `HTMLMediaElement`.

**Pure** modules under `src/shared/` (everything except this folder) must stay
free of those APIs so Node server code and unit tests can import them safely.

Prefer `@/client/*` for feature-sized browser packages (realtime, local-media
runtime). Use this folder for small cross-cutting storage / DOM utilities
shared by components and client packages.
