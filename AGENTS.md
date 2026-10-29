# Agent Guidelines

## Project map

| Item                         | Where                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Product / ops docs           | [README.md](./README.md) — requirements, env vars, architecture, multi-replica SFU |
| Release / migration          | [CHANGELOG.md](./CHANGELOG.md), [docs/MIGRATION-v3.md](./docs/MIGRATION-v3.md)     |
| Env schema                   | [`src/env.ts`](./src/env.ts); copy [`.env.example`](./.env.example)                |
| App + HTTP APIs              | `src/app`                                                                          |
| WebSocket upgrade            | `src/pages/api/ws.ts`                                                              |
| Edge middleware (CSP / CORS) | `src/proxy.ts`                                                                     |
| Wire schemas / types         | `src/contracts`                                                                    |
| Shared helpers               | `src/shared` (`shared/dom`, `@/shared/test-utils` fixtures)                        |
| Browser packages             | `src/client/{realtime,local-media,player}`                                         |
| Server packages              | `src/server/{realtime,redis,ws,security,media}`                                    |
| Ports / wiring               | `src/server/ports.ts`, `src/server/realtime/wire-ports.ts`                         |
| React composition            | `src/hooks` → `src/client/*`; UI in `src/components`                               |
| Local-media SW               | `src/sw`                                                                           |

Full layout table: [README Architecture](./README.md#architecture-developers).

## Tests

| Command                                                                                                         | Needs                                                                       |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `bun run test:unit`                                                                                             | Nothing extra                                                               |
| `bun run test:integration`                                                                                      | Valkey / `VALKEY_URL`                                                       |
| `bun run test:a11y` / `test:e2e` / `test:e2e:ws` / `test:e2e:password` / `test:e2e:local-media` / `test:e2e:ui` | Healthy app (see CI)                                                        |
| `bun run test:e2e:all` / `test:full`                                                                            | Live suites: all e2e (+ unit/integration for `full`); need Valkey + app     |
| `bun run test:fuzz`                                                                                             | Valkey; **not in CI** — run when changing presence / state-store invariants |
| `bun run start`                                                                                                 | Standalone production server (syncs static/public into `.next/standalone`)  |

Prefer `@/shared/test-utils` fixtures in client/UI tests over `@/server` fixtures where practical.

## Quality gates

CI enforces all three in the **Quality** job. Before finishing agent work or opening a PR, run each and fix failures:

| Gate      | Command           | Notes                                                                   |
| --------- | ----------------- | ----------------------------------------------------------------------- |
| Typecheck | `bun check`       | Bun built-in TypeScript **7** checker (CI source of truth)              |
| Lint      | `bun lint`        | Bun built-in linter (`bunfig.toml`; needs Bun canary until next stable) |
| Format    | `bun fmt --check` | Bun formatter. Fix with `bun fmt` / `bun run format:write`              |

### CI jobs

| Job         | What it runs                                                         |
| ----------- | -------------------------------------------------------------------- |
| **Quality** | SW verify, `bun check`, `bun lint`, `bun fmt --check`                |
| **Test**    | Unit + integration (Valkey); needs Quality                           |
| **E2E**     | Build + a11y + browser/WS/password/local-media/UI e2e; needs Quality |
| **Docker**  | Multi-arch push on `push` only; needs Quality + Test + E2E           |

### Typecheck

| Context             | Command / setup                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **CI / CLI**        | `bun check` — Bun’s TypeScript **7** checker (`process.versions.typescript`)                                        |
| **IDE / workspace** | `typescript@7.0.2` (matches Bun); `.vscode/settings.json` points `typescript.tsdk` at `node_modules/typescript/lib` |

Prefer fixing failures from `bun check`. Treat `bun lint` and `bun fmt --check` as equal CI blockers — do not skip format after check/lint pass.

**Bun version:** CI / `packageManager` pin a **1.4.4 canary** because stable 1.4.4 does not expose `bun lint` in release builds. Install with `bun upgrade --canary` (or match the `packageManager` canary) until the next stable ships lint. `bun check` / `bun fmt` work on stable 1.4.4; Docker builder stays on `oven/bun:1.4.4-alpine`.

Do not add a `"lint": "bun lint"` script — it recurses; invoke `bun lint` directly (as CI does).

## Git commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Examples:

- `feat: add playlist drag-and-drop reordering`
- `fix(player): correct sync drift on seek`
- `chore: update dependencies`

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
