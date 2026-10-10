# Agent Guidelines

## Project map

- **Product / ops docs:** [README.md](./README.md) — requirements, env vars, architecture, multi-replica SFU (sticky `/api/ws`).
- **Env schema:** [`src/env.ts`](./src/env.ts) (copy [`.env.example`](./.env.example)).
- **Layout:** `src/app` (App Router pages + HTTP APIs), `src/pages/api/ws.ts` (WebSocket upgrade), `src/proxy.ts` (Edge CSP/CORS), `src/contracts` (schemas/types), `src/shared` (framework-agnostic helpers + `shared/dom` + `@/shared/test-utils` fixtures), `src/client/{realtime,local-media,player}`, `src/server/{realtime,redis,ws,security,media}`, `src/hooks` (compose `client/*`), `src/components` (UI), `src/sw` (local-media service worker). Prefer these over legacy `src/lib` / `src/zod` (removed). See README Architecture table for the same map.
- **Tests:** `bun run test:unit`, `test:integration`, `test:a11y`, `test:e2e`, `test:e2e:ws` (`test:integration` needs Valkey/`VALKEY_URL`; latter three need a healthy app; see CI). Client/UI tests should use `@/shared/test-utils` fixtures, not `@/server` fixtures, where practical.
- **Optional deep run:** `bun run test:fuzz` — property/fuzz suite against Valkey; not part of CI (slow; run locally when changing presence/state-store invariants).
- **Typecheck (dual TypeScript — IDE TS6 vs CI TS7):**
  - **CI gate (source of truth):** `bun run typecheck` runs TypeScript **7** via `@typescript/native` (`bunx --package @typescript/native tsc -p tsconfig.json --noEmit`). Prefer fixing issues that fail this command — it is what gates PRs in the main CI `Test` job.
  - **IDE / workspace:** the `typescript` dependency is aliased to `@typescript/typescript6` (TS **6**). `.vscode/settings.json` sets `typescript.tsdk` to `node_modules/typescript/lib` (and prompts to use the workspace SDK) so the editor matches local TS6, not the CI TS7 binary.
  - **Optional advisory CI:** job **Typecheck (IDE TS6, advisory)** runs the same `tsc` as the IDE (`./node_modules/.bin/tsc -p tsconfig.json --noEmit`) with `continue-on-error`. It does not block merge or Docker; use it to spot IDE/CI drift. If TS6 and TS7 disagree, fix the CI TS7 failure first.

## Git Commits

Commit messages must adhere to the [Conventional Commits](https://www.conventionalcommits.org/) naming scheme.

Format: `<type>[optional scope]: <description>`

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Examples:
- `feat: add playlist drag-and-drop reordering`
- `fix(player): correct sync drift on seek`
- `chore: update dependencies`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
