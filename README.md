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

| Event | When | Payload |
|-------|------|---------|
| `room:control` | Instant play/pause/seek/select + ephemeral seek preview | `playback`, `currentIndex`, `generation` |
| `presence:batch` | Coalesced (~250ms) viewer clocks | per-user `localPlayback` patches |
| `room:snapshot` | Coalesced (~100ms) structural changes + join catch-up | sanitized full room |

Presence ticks never rewrite full Redis room state. Media relay caches yt-dlp extracts in Valkey and coalesces HLS playlist rewrites in-process (segment egress still scales with viewers).

## Development

```bash
bun install
cp .env.example .env
bun run dev
```

Useful scripts: `bun run typecheck`, `bun run test`, `bun run lint`.

## Session kinds

| Route | Kind | Room mutations | Own quality/captions |
|-------|------|----------------|----------------------|
| `/room/[id]` | `room` | owner/moderator by role | yes |
| `/room/[id]/player` | `player` | no (OBS/display) | yes |
| `/room/[id]/control` | `control` | role + control token | yes |

Control embed URLs are minted via `POST /api/control/token` and include `#uid=&secret=&ct=`. Hash is consumed into localStorage and stripped on load.

## Media pipeline

1. Resolve remote URLs with yt-dlp (or native host detection)
2. Build a bounded catalog of adaptive + combined streams
3. If CORS blocks direct play, wrap catalog URLs in `/api/media/proxy/{token}`
4. HLS playlists are rewritten so segments stay on same-origin proxy
5. Quality / captions preferences live on **participant** state (`viewerMedia`), shared across that user’s sessions — not room-wide
6. **Local files** stay on the providing browser’s `File` handle (no upload, no size cap). Viewers request `/api/media/local/{id}` ranges; the server asks the provider over WebSocket and proxies the bytes. The provider plays via a blob URL. Keep the tab that shared the file open.

## Operator / ops

Set `OPS_SECRET` in production. Examples:

```bash
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://localhost:3000/api/rooms/cleanup
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://localhost:3000/api/playlist/defaults/refresh
```

Health check: `GET /api/health` (Valkey ping).

Key env vars (see `.env.example`): `VALKEY_URL`, `YTDLP_*`, `OPS_SECRET`, `CONTROL_TOKEN_TTL_SECONDS`, `PROXY_ALLOW_PRIVATE_URLS`, `LOCAL_MEDIA_RELAY_CHUNK_BYTES`, `LOCAL_MEDIA_RELAY_TIMEOUT_MS`.

## Production

```bash
docker compose up -d --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Compose publishes IPv4 loopback only, so the stack is not reachable from other machines on the LAN.

### Troubleshooting: browser hangs, curl works

On Windows, if Firefox/Chrome spin forever on `http://127.0.0.1:3000` while `curl http://localhost:3000` returns instantly, another process (often **VS Code / Cursor port forwarding**) is usually bound to `127.0.0.1:3000` and accepting TCP without answering HTTP. `localhost` may still work via IPv6 while IPv4 is broken.

Check listeners:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object LocalAddress, OwningProcess |
  Format-Table -AutoSize
Get-Process -Id <OwningProcess>
```

Stop the extra forwarder (or close that editor window’s Ports panel), then `docker compose up -d` again. Compose binds `127.0.0.1:3000` so a later `127.0.0.1`-only forwarder cannot silently steal IPv4. Prefer `http://127.0.0.1:3000` when testing locally.

### Runbook notes

- Rotate `OPS_SECRET` by updating env and restarting
- Control tokens expire with `CONTROL_TOKEN_TTL_SECONDS` (default 12h); mint again from the room View menu
- Proxy tokens reuse by upstream URL hash; abandoned keys expire (7d sliding TTL)
- Raise `YTDLP_MAX_CONCURRENT` carefully under load; prefer horizontal Valkey + sticky or shared identity keys (already Redis-backed)
