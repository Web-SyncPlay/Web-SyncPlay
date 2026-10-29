# Contributing

Thanks for helping improve Web-SyncPlay. Keep changes focused; match existing style and layout ([AGENTS.md](./AGENTS.md), [README.md](./README.md)).

## Setup

| Tool                  | Version                                                  |
| --------------------- | -------------------------------------------------------- |
| [Bun](https://bun.sh) | **1.4.4-canary** (`packageManager` / CI; for `bun lint`) |
| Node.js               | **≥ 26** (`engines.node`; Docker image / native tooling) |

```bash
bun install
cp .env.example .env
docker compose up -d valkey   # or any Valkey/Redis at VALKEY_URL
bun run dev
```

## Checks before a PR

| Command             | Notes                                      |
| ------------------- | ------------------------------------------ |
| `bun run test:unit` | Prefer locally (no live app)               |
| `bun check`         | CI typecheck gate (Bun / TypeScript **7**) |
| `bun lint`          | Bun linter                                 |
| `bun fmt --check`   | Bun formatter; fix with `bun fmt`          |

All three of `bun check`, `bun lint`, and `bun fmt --check` are CI **Quality** job gates — run them together. CI then runs **Test** (unit/integration) and **E2E** in parallel. Prefer fixing `bun check` type failures. Details: [AGENTS.md](./AGENTS.md).

Integration / e2e / a11y need Valkey or a healthy app — see [README](./README.md#quick-start-development).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>
```

Examples: `feat: …`, `fix(player): …`, `docs: …`, `chore: …`.

## Pull requests

- State what changed and why; note breaking changes or new env vars.
- Link related issues; update README / ops docs when behavior or deploy steps change.
- Keep the diff reviewable; one concern per PR when practical.

Use the PR template checklist. Issue templates live under [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/).

## Conduct and security

- Be respectful: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- **Do not** open public issues for vulnerabilities — report privately per [SECURITY.md](./SECURITY.md) (GitHub Security Advisories or [@Yasamato](https://github.com/Yasamato)).
