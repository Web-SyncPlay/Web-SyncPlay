# Web-SyncPlay

[![WCAG 2.2 AAA](https://img.shields.io/badge/WCAG%202.2-AAA-0550ae?logo=w3c&logoColor=white)](https://www.w3.org/WAI/WCAG22/quickref/?levels=aaa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/ci.yml/badge.svg)](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/codeql-analysis.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Web-SyncPlay/Web-SyncPlay/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Web-SyncPlay/Web-SyncPlay)
[![Docker Pulls](https://img.shields.io/docker/pulls/websyncplay/websyncplay)](https://hub.docker.com/r/websyncplay/websyncplay)

Watch video or audio in sync with friends. One Next.js app: WebSocket realtime, Valkey-backed rooms (1h TTL), yt-dlp for remote media, and browser-held local files (HTTP relay / WebRTC).

**Stack:** Bun · Next.js · React · TypeScript · Tailwind · Vidstack · mediasoup · Valkey · yt-dlp

| Section                                                                 | For                                 |
| ----------------------------------------------------------------------- | ----------------------------------- |
| [Requirements](#requirements) / [Quick start](#quick-start-development) | Local development                   |
| [Deploy](#deploy)                                                       | Docker, ports, multi-replica SFU    |
| [Environment variables](#environment-variables)                         | Config reference (`src/env.ts`)     |
| [Using the app](#using-the-app) / [Embed](#embed-on-your-site)          | Routes and host-site iframes        |
| [Architecture](#architecture-developers)                                | Source layout and media paths       |
| [Contributing](#contributing)                                           | Setup, checks, PR expectations      |
| [Security](#security--accessibility)                                    | Reporting and a11y gate             |
| [Changelog](./CHANGELOG.md) / [Migrate from v2](./docs/MIGRATION-v3.md) | v3.0.0 notes and greenfield cutover |

Agent-oriented map and dual TypeScript notes: [AGENTS.md](./AGENTS.md).

### Release caveats (v3)

- **SFU:** Prefer a **single `web` replica**; mediasoup is process-local on fixed **UDP `40000`**. **No TURN** (STUN-only; UDP-blocked clients use HTTP relay). Sticky `/api/ws` alone does **not** make SFU cluster-safe — see [Multi-replica operations (SFU)](#multi-replica-operations-sfu).
- **Rooms:** Valkey-backed state with ~**1 hour** TTL; no durable v2 room import ([migration](./docs/MIGRATION-v3.md)).
- **Rate limits:** Hot WebSocket paths **fail closed** if Valkey errors — keep Valkey healthy/low-latency on WS nodes.
- **Accessibility:** WCAG 2.2 AAA badge reflects the **automated** axe CI gate (`bun run test:a11y`), not a formal W3C certification — see [Security & accessibility](#security--accessibility).
- **Upgrading from v2:** Port `8081`→`3000`, `REDIS_URL`→`VALKEY_URL`, Socket.IO and ops HTTP gone — [CHANGELOG](./CHANGELOG.md) · [MIGRATION-v3](./docs/MIGRATION-v3.md).

## Requirements

| Tool                  | Version                                                  |
| --------------------- | -------------------------------------------------------- |
| [Bun](https://bun.sh) | **1.4.2** (`packageManager` / CI)                        |
| Node.js               | **≥ 26** (`engines.node`; Docker image / native tooling) |

**TypeScript:** IDE = TS **6** (`typescript` → `@typescript/typescript6`); CI gate = TS **7** via `@typescript/native` (`bun check`). Prefer fixing issues that fail `bun check`. Details: [AGENTS.md](./AGENTS.md).

## Quick start (development)

```bash
bun install
cp .env.example .env
docker compose up -d valkey   # or any Valkey/Redis at VALKEY_URL
bun run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

| Script                                                                                                          | Purpose                                                     |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `bun check`                                                                                                     | CI TypeScript 7 gate                                        |
| `bun run lint`                                                                                                  | ESLint                                                      |
| `bun run format`                                                                                                | Prettier check (CI); fix with `bun run format:write`        |
| `bun run test:unit`                                                                                             | Unit tests (no live app; prefer this locally)               |
| `bun run test:integration`                                                                                      | Needs Valkey / `VALKEY_URL`                                 |
| `bun run test`                                                                                                  | Full `bun test` suite (includes integration → needs Valkey) |
| `bun run test:a11y` / `test:e2e` / `test:e2e:ws` / `test:e2e:password` / `test:e2e:local-media` / `test:e2e:ui` | Need a healthy app (`bun run start` or `dev`)               |
| `bun run test:e2e:all`                                                                                          | All a11y + e2e scripts (needs healthy app)                  |
| `bun run test:full`                                                                                             | Unit + integration + `test:e2e:all` (Valkey + healthy app)  |
| `bun run test:fuzz`                                                                                             | Optional Valkey property suite (not in CI)                  |
| `bun run check:local-media-sw`                                                                                  | Verify committed SW artifact matches source                 |
| `bun run start`                                                                                                 | Production standalone runner (`node .next/standalone/…`)    |

Local Bun may skip the mediasoup native worker; the Docker image runs the in-process SFU.

## Deploy

Product version is the git tag, `package.json` `version`, and Docker semver tags published from CI.

### Pull image

Minimal `docker-compose.yml` (pin a release tag in production; `latest` tracks
`main`):

```yaml
services:
  web:
    image: websyncplay/websyncplay:3.0.0
    restart: unless-stopped
    environment:
      VALKEY_URL: redis://valkey:6379
      PUBLIC_DOMAIN: web-syncplay.example
    ports:
      - "3000:3000"
      - "40000:40000/udp"
    depends_on:
      valkey:
        condition: service_healthy
  valkey:
    image: valkey/valkey:9
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "sh", "-c", "valkey-cli ping"]
      interval: 10s
      timeout: 3s
      retries: 10
```

```bash
docker compose up -d
```

### Build from this repo

`cp .env.example .env` then `docker compose up -d --build`. Compose loads `.env`, forces `VALKEY_URL=redis://valkey:6379` and `NODE_ENV=production`, and binds HTTP to `127.0.0.1:3000` and Valkey to `127.0.0.1:6379`.

Put TLS (reverse proxy) in front for public HTTP/WS.

| Port    | Proto | Purpose                                            |
| ------- | ----- | -------------------------------------------------- |
| `3000`  | TCP   | App + WebSocket (prefer 443 via proxy)             |
| `40000` | UDP   | mediasoup WebRTC SFU (**fixed**; not configurable) |

ICE is STUN-only (Google + Cloudflare). No TURN — UDP-blocked clients use HTTP local-media relay, not SFU.

### Operations

- `GET /api/health` — liveness (Valkey ping + yt-dlp config/metrics).
- Background tick: room cleanup, ownership repair, playlist-resolve reclaim.
- Daily defaults reseed from `FALLBACK_DEFAULT_MEDIA_URL` when the cache is empty or expired.

Hot WebSocket control paths rate-limit via Valkey token buckets (`rate:ws:*`), shared across replicas per `(roomId, userId)`. High-frequency types (`seek:preview`, `local-media:webrtc:signal`) prepaid-batch a few tokens per EVAL then allow locally; other hot types cost one EVAL per message. Fail-closed on Valkey errors — keep Valkey latency low on WS nodes.

### Multi-replica operations (SFU)

Room sync and remote media scale across replicas via Valkey. Local-media HTTP can too when `INTERNAL_NODE_BASE_URL` and `LOCAL_MEDIA_INTERNAL_SECRET` are set. **mediasoup SFU does not** — routers, transports, and the WS registry are process-local.

| Path                            | Cross-replica? | Notes                                                                                                   |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| Room sync / playlist / presence | Yes            | Valkey + pub/sub                                                                                        |
| Remote media (yt-dlp / proxy)   | Yes            | Shared cache and locks                                                                                  |
| Local-media HTTP relay          | Yes*           | Needs internal URL + secret; prefer affinity to the provider’s node                                     |
| Local-media P2P signaling       | Yes            | Valkey user-targeted fan-out; ICE/UDP is peer-side                                                      |
| mediasoup SFU (WebRTC)          | **No**         | Provider and SFU viewers must share the replica that holds the provider WS; UDP `40000` on that process |

**Affinity-sensitive paths**

- `/api/ws` — room control works without stickiness; SFU signaling and DataChannels require the viewer’s WS on the **same replica** as the file provider’s WS.
- UDP `40000` — fixed, process-local, **not configurable**. Multiple `web` replicas on one host **cannot** share the port.

**Sticky WS alone is not enough.** L7 stickiness on `/api/ws` co-locates signaling, but SFU media still fails if UDP `40000` cannot reach the provider’s pod.

**Recommendations**

- Prefer a **single `web` replica** for SFU-heavy deployments.
- With multiple replicas: sticky `/api/ws` **and** UDP `40000` to the **same** replica that holds the provider WS (e.g. `hostNetwork`, or a per-pod/host UDP mapping).
- Without WS stickiness, **SFU fails**. P2P signaling may still work via Valkey; P2P ICE/UDP is peer-side.

**Sticky `/api/ws` (reverse proxy)** — key on a cookie or client IP:

```nginx
# nginx — cookie hash (set Cookie wsp_node on first response if absent), or ip_hash
upstream websyncplay {
  hash $cookie_wsp_node consistent;
  # ip_hash;  # alternative: client-IP affinity
  server 10.0.0.1:3000;
  server 10.0.0.2:3000;
}

location /api/ws {
  proxy_pass http://websyncplay;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

```caddy
# Caddy — cookie affinity (or lb_policy ip_hash)
reverse_proxy /api/ws 10.0.0.1:3000 10.0.0.2:3000 {
  lb_policy cookie wsp_node
  # lb_policy ip_hash
}
```

## Environment variables

Schema: [`src/env.ts`](./src/env.ts). Copy [`.env.example`](./.env.example) for local use. Empty strings are treated as unset. Set `SKIP_ENV_VALIDATION=1` to skip validation (e.g. Docker image build).

### Must set to deploy

| Variable        | Default | Description                                                                                                                               |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `VALKEY_URL`    | —       | Valkey/Redis URL. Compose overrides to `redis://valkey:6379`. Local Bun typically `redis://localhost:6379`.                               |
| `PUBLIC_DOMAIN` | unset   | Public hostname or origin (`web-syncplay.de` or `https://…`). Drives ICE `announcedAddress`, CORS, CSP. Omit only for localhost-only use. |

### Multi-replica

Set **both** on every `web` replica for sticky local-media HTTP affinity (miss path: provider WS → internal HTTP → Valkey pub/sub). Keep the internal route off public ingress. SFU remains process-local either way — see [Multi-replica operations (SFU)](#multi-replica-operations-sfu).

| Variable                      | Default | Description                                                                                                               |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_NODE_BASE_URL`      | unset   | **Per-replica** reachable base URL (pod DNS / unique hostname). Do **not** use shared service DNS like `http://web:3000`. |
| `LOCAL_MEDIA_INTERNAL_SECRET` | unset   | Shared secret (≥16 chars) for `/api/media/local/internal/*`.                                                              |

### Optional

| Variable                     | Default                        | Description                                                                          |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `NODE_ENV`                   | `production`                   | `development` \| `test` \| `production`. Compose forces `production`.                |
| `YTDLP_BIN`                  | `yt-dlp`                       | yt-dlp binary (installed in the Docker image).                                       |
| `YTDLP_MAX_CONCURRENT`       | `2`                            | Max concurrent extracts per process.                                                 |
| `YTDLP_TIMEOUT_MS`           | `30000`                        | Extract timeout (1s–120s). Also drives lock heartbeat / reclaim intervals.           |
| `FALLBACK_DEFAULT_MEDIA_URL` | `https://youtu.be/uD4izuDMUQA` | Seed media when daily defaults cache is empty.                                       |
| `ROOM_PARTICIPANTS_LIMIT`    | `100`                          | Max participants per room (1–100).                                                   |
| `ROOM_PLAYLIST_LIMIT`        | `50`                           | Max playlist items per room (1–200).                                                 |
| `ROOM_ACTION_LOG_LIMIT`      | `500`                          | Max action-log entries retained (1–1000).                                            |
| `PROXY_ALLOW_PRIVATE_URLS`   | `false`                        | Allow proxying private/LAN URLs. Always forced `false` in production.                |
| `EMBED_FRAME_ANCESTORS`      | unset                          | Space-separated absolute origins (or `*`) allowed to iframe this app. Default: none. |
| `NEXT_TELEMETRY_DISABLED`    | `1` (true)                     | Next.js telemetry off by default. Set `0` only to opt in.                            |
| `SKIP_ENV_VALIDATION`        | unset                          | Set truthy to skip env schema validation (e.g. image build).                         |

## Using the app

| Route                | Kind      | Mutations                 | Notes                                                                                                        |
| -------------------- | --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/room/[id]`         | `room`    | By role (owner/moderator) | Main session                                                                                                 |
| `/room/[id]/embed`   | `embed`   | By role (owner/moderator) | Host-site iframe; optional `?media=` seeds **new** rooms only                                                |
| `/room/[id]/player`  | `player`  | None                      | OBS / display                                                                                                |
| `/room/[id]/control` | `control` | Role + control token      | Minted via `POST /api/control/token` (`#uid=&secret=&ct=`; uid/secret → localStorage, `ct` → sessionStorage) |

Quality and captions are per-participant (`viewerMedia`), shared across that user’s sessions.

## Embed on your site

Use Web-SyncPlay as a synced player inside an existing site. The host supplies a **room ID** and optional **media URL**; SyncPlay keeps viewers in sync.

**1. Allow framing** — set `EMBED_FRAME_ANCESTORS` (space-separated absolute origins, or `*`):

```bash
EMBED_FRAME_ANCESTORS=https://your-site.example
```

**2. Embed the interactive player:**

```html
<iframe
  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
  style="border:none;width:100%;height:100%"
  src="https://sync.example.com/room/{roomId}/embed?media={encodeURIComponent(mediaUrl)}"
></iframe>
```

| Piece                 | Behavior                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `roomId`              | Host-chosen string (1–128 chars). First visitor creates the room and becomes owner.                                                                                |
| `?media=`             | Create-time seed only. Ignored (and stripped) if the room already exists. Unsupported/blocked URLs reject **new** room creation with a dedicated embed error page. |
| `/embed` vs `/player` | `/embed` is interactive (role-gated). `/player` is view-only for OBS/display.                                                                                      |
| `/control`            | Separate remote-control surface with a minted token — not required for basic embeds.                                                                               |

Reusing a room ID with a new `media` query does **not** replace the playlist. Change media from the embed UI, or open a new room ID.

## Architecture (developers)

| Path                     | Role                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `src/app`                | App Router pages + HTTP APIs                                       |
| `src/pages/api/ws.ts`    | WebSocket upgrade (Pages Router)                                   |
| `src/proxy.ts`           | Edge middleware (CSP / CORS)                                       |
| `src/contracts`          | Shared Zod schemas + wire types (C2S/S2C)                          |
| `src/shared`             | Framework-agnostic helpers (`shared/dom`, `@/shared/test-utils`)   |
| `src/client/realtime`    | Room socket, join, control token, S2C dispatch                     |
| `src/client/local-media` | Local file provider, SW bridge, P2P/SFU adapters                   |
| `src/client/player`      | Playback sync engine + apply helpers                               |
| `src/server/realtime`    | Join, playlist, playback, permissions, socket dispatch             |
| `src/server/redis`       | Valkey client, keys, pub/sub fan-in, room state store              |
| `src/server/ports.ts`    | Store / publish / SFU / resolve ports (`wire-ports.ts` wires them) |
| `src/server/ws`          | WebSocket registry, transport, request dedupe                      |
| `src/server/security`    | Rate limits, URL safety                                            |
| `src/server/media`       | Resolve, proxy, HLS rewrite, yt-dlp, local media, SFU              |
| `src/hooks`              | React hooks that compose `src/client/*`                            |
| `src/components`         | UI                                                                 |
| `src/sw`                 | Local-media service worker source                                  |

**Realtime outbound:** `room:control` (instant play/pause/seek), `presence:batch` (~250ms clocks), `room:snapshot` (~100ms structure). Presence ticks do not rewrite full Valkey room state.

**Remote media:** resolve (yt-dlp or native host) → Valkey-cached extract → stream catalog → same-origin proxy when CORS blocks → HLS rewrite. Cluster-safe locks/leases reclaim abandoned resolves.

**Local files:** stay on the sharer’s browser `File` (no upload). Delivery order: **SFU → P2P → HTTP relay**. SFU is process-local (UDP 40000). P2P signaling is cluster-aware (Valkey user-targeted fan-out); ICE/UDP remains peer-side. Ops checklist: [Multi-replica operations (SFU)](#multi-replica-operations-sfu). Optional ABR via ffmpeg.wasm on the provider.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Security & accessibility

- Vulnerabilities: [`SECURITY.md`](./SECURITY.md) (supported line: **3.x**). Scorecard + Dependabot on `main`.
- UI a11y: axe-core **WCAG 2.2 AAA** in CI (`bun run test:a11y`). Automated gate, not a formal W3C certification.
- Release history and operator breaking changes: [`CHANGELOG.md`](./CHANGELOG.md). v2 → v3 cutover: [`docs/MIGRATION-v3.md`](./docs/MIGRATION-v3.md).
