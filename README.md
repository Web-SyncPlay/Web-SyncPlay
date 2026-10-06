# Web-SyncPlay

Watch videos or play music in sync with friends. Unified Next.js app with an embedded WebSocket realtime layer and Valkey-backed room state (1h TTL).

## Stack

- Bun for install, dev, and production runtime
- Next.js + React + TypeScript
- Tailwind CSS + shadcn/ui + Lucide
- Vidstack player
- Valkey/Redis for room state, proxy tokens, identities, control tokens
- yt-dlp for remote media extraction
- Docker Compose deployment

## Layout

- `src/app` — App Router pages and HTTP API routes
- `src/pages/api/ws.ts` — WebSocket upgrade entry
- `src/server/realtime` — join, playlist, playback, permissions
- `src/server/media` — resolve, relay proxy, HLS rewrite, yt-dlp
- `src/zod` — shared types and Zod schemas
- `src/components` — room / player / control UI

## Realtime channels

Outbound WebSocket events are split for performance:

| Event            | When                                                    | Payload                                  |
| ---------------- | ------------------------------------------------------- | ---------------------------------------- |
| `room:control`   | Instant play/pause/seek/select + ephemeral seek preview | `playback`, `currentIndex`, `generation` |
| `presence:batch` | Coalesced (~250ms) viewer clocks                        | per-user `localPlayback` patches         |
| `room:snapshot`  | Coalesced (~100ms) structural changes + join catch-up   | sanitized full room                      |

Presence ticks never rewrite full Redis room state. Media relay caches yt-dlp extracts in Valkey and coalesces HLS playlist rewrites in-process (segment egress still scales with viewers).

## Development

```bash
bun install
cp .env.example .env
# Needs Valkey at VALKEY_URL — e.g. docker compose up -d valkey
bun run dev
```

Useful scripts: `bun run typecheck`, `bun run test`, `bun run lint`.

## Session kinds

| Route                | Kind      | Room mutations          | Own quality/captions |
| -------------------- | --------- | ----------------------- | -------------------- |
| `/room/[id]`         | `room`    | owner/moderator by role | yes                  |
| `/room/[id]/player`  | `player`  | no (OBS/display)        | yes                  |
| `/room/[id]/control` | `control` | role + control token    | yes                  |

Control embed URLs are minted via `POST /api/control/token` and include `#uid=&secret=&ct=`. Hash is consumed into localStorage and stripped on load.

## Media pipeline

1. Resolve remote URLs with yt-dlp (or native host detection). YouTube/Vimeo and direct file URLs skip yt-dlp.
2. Cache extracts in Valkey with a versioned envelope. Stream URL freshness, heartbeat locks, and dump format bounds are derived from `YTDLP_CACHE_TTL_SECONDS` / `YTDLP_TIMEOUT_MS` (no extra knobs). Across instances, only the Valkey lock holder runs yt-dlp; waiters poll the shared cache and failover if the holder’s heartbeat lease expires. Playlist resolves also take a Valkey lease so a crashed server’s in-flight item is reclaimed and redone.
3. Build a bounded catalog of adaptive + combined streams
4. If CORS blocks direct play, wrap catalog URLs in `/api/media/proxy/{token}`
5. HLS playlists are rewritten so segments stay on same-origin proxy. Upstream 401/403 triggers cache invalidation + playlist re-resolve (`409 upstream_expired`).
6. Quality / captions preferences live on **participant** state (`viewerMedia`), shared across that user’s sessions — not room-wide
7. **Local files** stay on the providing browser’s `File` handle (no upload, no size cap). Viewers request `/api/media/local/{id}` ranges; the server asks the provider over WebSocket and proxies the bytes. Keep the tab that shared the file open.
   - **Provider ready**: metadata is marked ready on share and on reconnect announce; GET fail-fasts with `provider_unavailable` when the sharer’s tab no longer holds the `File`.
   - **Binary LMC chunks**: provider replies use compact binary WebSocket frames (JSON/`dataBase64` remains as a fallback error path).
   - **Block cache**: aligned ranges use L1 in-process memory (singleflight + LRU) then L2 Valkey/Redis so concurrent viewers and multi-instance relays share one provider upload per block.

## Local media architecture (roadmap)

- **Phase now**: provider `File` + server HTTP range relay + L1 memory / L2 Redis block cache + binary WS chunk frames + `providerReady` fail-fast.
- **Next**: Redis/shared cache is already in place; optional sticky provider affinity so range requests prefer the node holding the provider socket.
- **Elevate**: SFU / WebRTC datachannels or an edge cache so server egress is not N× viewers; optional File System Access API to persist the handle across refresh; adaptive bitrate packaging of local files for smoother multi-viewer playback.

## Operator / ops

Set `OPS_SECRET` in production (ops routes return 503 if unset). Examples:

```bash
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://127.0.0.1:3000/api/rooms/cleanup
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://127.0.0.1:3000/api/playlist/defaults/refresh
```

Health check: `GET /api/health` (Valkey ping).

Key env vars (see `.env.example`): `VALKEY_URL`, `YTDLP_*`, `OPS_SECRET`, `CONTROL_TOKEN_TTL_SECONDS`, `PROXY_ALLOW_PRIVATE_URLS`, `WS_HEARTBEAT_INTERVAL_MS`, room limits.

## Production (Docker Compose)

### Quick deploy (pull image)

Save as `docker-compose.yml`, set `OPS_SECRET`, then run `docker compose up -d`:

```yaml
services:
  web:
    image: websyncplay/websyncplay:latest
    restart: unless-stopped
    environment:
      VALKEY_URL: redis://valkey:6379
      # Required for /api ops endpoints in production
      OPS_SECRET: change-me-to-a-long-random-string
    ports:
      - "3000:3000"
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

Open [http://localhost:3000](http://localhost:3000). Put a reverse proxy (TLS) in front for public internet.

### From this repo (build locally)

```bash
cp .env.example .env
# Uncomment and set OPS_SECRET in .env (required for ops endpoints in production)
docker compose up -d --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The repo compose loads optional `.env` into the web service, then forces `VALKEY_URL=redis://valkey:6379` and `NODE_ENV=production` (so a local-dev `.env` stays safe to reuse). HTTP is published on `127.0.0.1:3000` and Valkey on `127.0.0.1:6379` — neither is reachable from other LAN machines. Use the Valkey publish when running `bun run dev` against compose Valkey (`VALKEY_URL=redis://localhost:6379`).

### Runbook notes

- Rotate `OPS_SECRET` by updating `.env` and restarting (`docker compose up -d`)
- Control tokens expire with `CONTROL_TOKEN_TTL_SECONDS` (default 12h); mint again from the room View menu
- Proxy tokens reuse by upstream URL hash; abandoned keys expire (7d sliding TTL)
- Raise `YTDLP_MAX_CONCURRENT` carefully under load; prefer horizontal Valkey + sticky or shared identity keys (already Redis-backed)
