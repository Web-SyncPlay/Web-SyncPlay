# Agent Guidelines

## Project map

| Item                         | Where                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Product / ops docs           | [README.md](./README.md) — requirements, env vars, architecture, multi-replica SFU |
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

| Command                                          | Needs                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `bun run test:unit`                              | Nothing extra                                                               |
| `bun run test:integration`                       | Valkey / `VALKEY_URL`                                                       |
| `bun run test:a11y` / `test:e2e` / `test:e2e:ws` | Healthy app (see CI)                                                        |
| `bun run test:fuzz`                              | Valkey; **not in CI** — run when changing presence / state-store invariants |

Prefer `@/shared/test-utils` fixtures in client/UI tests over `@/server` fixtures where practical.

## Typecheck (IDE TS6 vs CI TS7)

| Context                       | Command / setup                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **CI gate (source of truth)** | `bun run typecheck` → TypeScript **7** via `@typescript/native`                                                                        |
| **IDE / workspace**           | `typescript` → `@typescript/typescript6` (TS **6**); `.vscode/settings.json` points `typescript.tsdk` at `node_modules/typescript/lib` |
| **Advisory CI**               | Job **Typecheck (IDE TS6, advisory)** runs `./node_modules/.bin/tsc` with `continue-on-error`                                          |

Prefer fixing failures from `bun run typecheck`. If TS6 and TS7 disagree, fix the CI TS7 failure first.

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

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
