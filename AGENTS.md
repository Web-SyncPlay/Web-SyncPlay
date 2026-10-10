# Agent Guidelines

## Project map

- **Product / ops docs:** [README.md](./README.md) — requirements, env vars, architecture, multi-replica SFU (sticky `/api/ws`).
- **Env schema:** [`src/env.ts`](./src/env.ts) (copy [`.env.example`](./.env.example)).
- **Layout:** `src/contracts` (schemas/types), `src/shared` (framework-agnostic helpers + `@/shared/test-utils` fixtures), `src/client/{realtime,local-media,player}`, `src/server/{realtime,redis,ws,security,media}`. Prefer these over legacy `src/lib` / `src/zod` (removed).
- **Tests:** `bun run test:unit`, `test:integration`, `test:a11y`, `test:e2e`, `test:e2e:ws` (`test:integration` needs Valkey/`VALKEY_URL`; latter three need a healthy app; see CI). Client/UI tests should use `@/shared/test-utils` fixtures, not `@/server` fixtures, where practical.
- **Optional deep run:** `bun run test:fuzz` — property/fuzz suite against Valkey; not part of CI (slow; run locally when changing presence/state-store invariants).
- **Typecheck:** CI truth is `bun run typecheck` (TypeScript **7** via `@typescript/native`). The IDE uses the workspace `typescript` package → `@typescript/typescript6` (TS6); `.vscode/settings.json` sets `typescript.tsdk` to `node_modules/typescript/lib`. Prefer fixing issues that fail `typecheck`.

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
