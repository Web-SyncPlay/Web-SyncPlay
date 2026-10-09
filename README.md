# Web-SyncPlay

[![WCAG 2.2 AAA](https://img.shields.io/badge/WCAG%202.2-AAA-0550ae?logo=w3c&logoColor=white)](https://www.w3.org/WAI/WCAG22/quickref/?levels=aaa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/ci.yml/badge.svg)](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/Web-SyncPlay/Web-SyncPlay/actions/workflows/codeql-analysis.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Web-SyncPlay/Web-SyncPlay/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Web-SyncPlay/Web-SyncPlay)
[![Docker Pulls](https://img.shields.io/docker/pulls/websyncplay/websyncplay)](https://hub.docker.com/r/websyncplay/websyncplay)

Watch video or audio in sync with friends. One Next.js app: WebSocket realtime, Valkey-backed rooms (1h TTL), yt-dlp for remote media, and browser-held local files (HTTP relay / WebRTC).

**Stack:** Bun · Next.js · React · TypeScript · Tailwind · Vidstack · mediasoup · Valkey · yt-dlp

## Requirements

| Tool | Version |
| ---- | ------- |
| [Bun](https://bun.sh) | **1.4.2** (`packageManager` / CI) |
| Node.js | **≥ 26** (`engines.node`; Docker image / native tooling) |

**TypeScript:** the IDE uses TypeScript **6** (`typescript` → `@typescript/typescript6`). CI/`bun run typecheck` uses TypeScript **7** via `@typescript/native`. Prefer fixing issues that fail `typecheck`.

## Quick start (development)

```bash
bun install
cp .env.example .env
docker compose up -d valkey   # or any Valkey/Redis at VALKEY_URL
bun run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Scripts: `typecheck`, `test`, `lint`, `test:a11y` / `test:e2e:ws` (app must be running).

Local Bun may skip the mediasoup native worker; the Docker image runs the in-process SFU.

## Deploy

**Pull image** — minimal `docker-compose.yml`:

```yaml
services:
  web:
    image: websyncplay/websyncplay:latest
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

**From this repo:** `cp .env.example .env` then `docker compose up -d --build`. Compose loads `.env`, forces `VALKEY_URL=redis://valkey:6379` and `NODE_ENV=production`, binds HTTP to `127.0.0.1:3000` and Valkey to `127.0.0.1:6379`.

Put TLS (reverse proxy) in front for public HTTP/WS. Firewall:

| Port    | Proto | Purpose                                        |
| ------- | ----- | ---------------------------------------------- |
| `3000`  | TCP   | App + WebSocket (prefer 443 via proxy)         |
| `40000` | UDP   | mediasoup WebRTC SFU (fixed; not configurable) |

ICE is STUN-only (Google + Cloudflare). No TURN — UDP-blocked clients use HTTP local-media relay, not SFU.

### Operations

`GET /api/health` — liveness (Valkey ping + yt-dlp config/metrics).

Room cleanup, ownership repair, and playlist-resolve reclaim run on a background tick. Daily defaults reseed from `FALLBACK_DEFAULT_MEDIA_URL` when the cache is empty or expired.

### Multi-replica operations (SFU)

Room sync and remote media scale across replicas via Valkey. Local-media HTTP can too when `INTERNAL_NODE_BASE_URL` and `LOCAL_MEDIA_INTERNAL_SECRET` are set. **mediasoup SFU does not** — routers, transports, and the WS registry are process-local.

| Path | Cross-replica? | Notes |
| ---- | -------------- | ----- |
| Room sync / playlist / presence | Yes | Valkey + Redis pub/sub |
| Remote media (yt-dlp / proxy) | Yes | Shared cache and locks |
| Local-media HTTP relay | Yes* | Needs internal URL + secret; prefer affinity to the provider’s node |
| mediasoup SFU (WebRTC) | **No** | Provider and SFU viewers must share the replica that holds the provider WS; UDP `40000` on that process |

**Affinity-sensitive paths**

- `/api/ws` — room control works without stickiness; SFU signaling and DataChannels require the viewer’s WS on the **same replica** as the file provider’s WS.
- UDP `40000` — must reach the mediasoup process on that replica (fixed port; not configurable).

**Recommendations**

- ICE remains STUN-only. No TURN — UDP-blocked clients use HTTP local-media relay (or P2P), not SFU.
- Prefer a **single `web` replica** for SFU-heavy deployments, or L7 sticky sessions on `/api/ws` so provider and SFU consumers stay co-located.
- Valkey does not globalize SFU; do not expect round-robin replicas to share a WebRTC session.

## Environment variables

Schema: [`src/env.ts`](./src/env.ts). Copy [`.env.example`](./.env.example) for local use. Empty strings are treated as unset. Set `SKIP_ENV_VALIDATION=1` to skip validation (e.g. Docker image build).

### Must set to deploy

| Variable        | Default | Description                                                                                                                               |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `VALKEY_URL`    | —       | Valkey/Redis URL. Compose overrides to `redis://valkey:6379`. Local Bun typically `redis://localhost:6379`.                               |
| `PUBLIC_DOMAIN` | unset   | Public hostname or origin (`web-syncplay.de` or `https://…`). Drives ICE `announcedAddress`, CORS, CSP. Omit only for localhost-only use. |

### Multi-replica

Set **both** on every `web` replica for sticky local-media HTTP affinity (miss path: provider WS → internal HTTP → Redis pub/sub). Keep the internal route off public ingress. SFU remains process-local either way — see [Multi-replica operations (SFU)](#multi-replica-operations-sfu).

| Variable                      | Default | Description                                                                |
| ----------------------------- | ------- | -------------------------------------------------------------------------- |
| `INTERNAL_NODE_BASE_URL`      | unset   | This replica’s reachable base URL (e.g. `http://web:3000` or per-pod DNS). |
| `LOCAL_MEDIA_INTERNAL_SECRET` | unset   | Shared secret (≥16 chars) for `/api/media/local/internal/*`.               |

### Optional

| Variable                     | Default                        | Description                                                                         |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `NODE_ENV`                   | `production`                   | `development` \| `test` \| `production`. Compose forces `production`.               |
| `YTDLP_BIN`                  | `yt-dlp`                       | yt-dlp binary (installed in the Docker image).                                      |
| `YTDLP_MAX_CONCURRENT`       | `2`                            | Max concurrent extracts per process. Raise carefully under load.                    |
| `YTDLP_TIMEOUT_MS`           | `30000`                        | Extract timeout (1s–120s). Also drives lock heartbeat / reclaim intervals.          |
| `YTDLP_CACHE_TTL_SECONDS`    | `1800`                         | Retention input for the Valkey extract cache (0–86400). Successful writes use a shorter TTL capped by derived stream-URL max age; failures stay short-lived (~60s). |
| `FALLBACK_DEFAULT_MEDIA_URL` | `https://youtu.be/uD4izuDMUQA` | Seed media when daily defaults cache is empty.                                      |
| `ROOM_PARTICIPANTS_LIMIT`    | `100`                          | Max participants per room (1–100).                                                  |
| `ROOM_PLAYLIST_LIMIT`        | `50`                           | Max playlist items per room (1–200).                                                |
| `ROOM_ACTION_LOG_LIMIT`      | `500`                          | Max action-log entries retained (1–1000).                                           |
| `CONTROL_TOKEN_TTL_SECONDS`  | `43200`                        | Control-embed token lifetime (60s–48h; default 12h). Remint from room View menu.    |
| `WS_HEARTBEAT_INTERVAL_MS`   | `5000`                         | WebSocket ping interval (100–30000). Timeout is always 3× this.                     |
| `PROXY_ALLOW_PRIVATE_URLS`   | `false`                        | Allow proxying private/LAN URLs. Always forced `false` in production.               |
| `EMBED_FRAME_ANCESTORS`      | unset                          | Space-separated absolute origins (or `*`) allowed to iframe this app. Default: none. |
| `NEXT_TELEMETRY_DISABLED`    | `1` (true)                     | Next.js telemetry off by default (dev, Compose, and image). Set `0` only to opt in. |
| `SKIP_ENV_VALIDATION`        | unset                          | Set truthy to skip env schema validation (e.g. image build).                        |

## Using the app

| Route                | Kind      | Mutations                 | Notes                                                                     |
| -------------------- | --------- | ------------------------- | ------------------------------------------------------------------------- |
| `/room/[id]`         | `room`    | By role (owner/moderator) | Main session                                                              |
| `/room/[id]/embed`   | `embed`   | By role (owner/moderator) | Host-site iframe; optional `?media=` seeds **new** rooms only             |
| `/room/[id]/player`  | `player`  | None                      | OBS / display                                                             |
| `/room/[id]/control` | `control` | Role + control token      | Minted via `POST /api/control/token` (`#uid=&secret=&ct=` → localStorage) |

Quality and captions are per-participant (`viewerMedia`), shared across that user’s sessions.

## Embed on your site

Use Web-SyncPlay as a synced player inside an existing streaming site. The host supplies a **room ID** and optional **media URL**; SyncPlay’s player UI handles play/pause/seek/playlist and keeps viewers in sync.

**1. Allow framing** — third-party iframes are blocked until you set `EMBED_FRAME_ANCESTORS` (space-separated absolute origins, or `*` for open embedding):

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

| Piece | Behavior |
| ----- | -------- |
| `roomId` | Host-chosen string (1–128 chars). First visitor creates the room and becomes owner; later visitors join the same session. |
| `?media=` | Create-time seed only. Ignored (and stripped) if the room already exists. Unsupported/blocked URLs reject **new** room creation with a dedicated embed error page. |
| `/embed` vs `/player` | `/embed` is interactive (role-gated controls). `/player` remains view-only for OBS/display. |
| `/control` | Separate remote-control surface with a minted token — not required for basic site embeds. |

Reusing a room ID with a new `media` query does **not** replace the playlist. Change media from SyncPlay’s UI inside the embed, or open a new room ID.

## Architecture (developers)

| Path                  | Role                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `src/app`             | App Router pages + HTTP APIs                                      |
| `src/pages/api/ws.ts` | WebSocket upgrade                                                 |
| `src/proxy.ts`        | Edge proxy (CSP / CORS)                                           |
| `src/server/realtime` | Join, playlist, playback, permissions                             |
| `src/server/media`    | Resolve, media proxy, HLS rewrite, yt-dlp, local media, SFU       |
| `src/hooks`           | Client room socket, session, and UI hooks                         |
| `src/lib`             | Shared client/server helpers (playback sync, local media, etc.)   |
| `src/sw`              | Service worker (local-media fetch/cache)                          |
| `src/zod`             | Shared types / schemas                                            |
| `src/components`      | UI                                                                |

**Realtime outbound:** `room:control` (instant play/pause/seek), `presence:batch` (~250ms clocks), `room:snapshot` (~100ms structure). Presence ticks do not rewrite full Redis room state.

**Remote media:** resolve (yt-dlp or native host) → Valkey-cached extract → stream catalog → same-origin proxy when CORS blocks → HLS rewrite. Cluster-safe locks/leases reclaim abandoned resolves.

**Local files:** stay on the sharer’s browser `File` (no upload). Delivery order: **SFU → P2P → HTTP relay**. SFU is process-local (UDP 40000); cross-replica viewers use P2P or HTTP. Ops checklist: [Multi-replica operations (SFU)](#multi-replica-operations-sfu). Optional ABR via ffmpeg.wasm on the provider.

## Security & accessibility

- Vulnerabilities: [`SECURITY.md`](./SECURITY.md). Scorecard + Dependabot on `main`.
- UI a11y: axe-core **WCAG 2.2 AAA** in CI (`bun run test:a11y`). Automated gate, not a formal W3C certification.
