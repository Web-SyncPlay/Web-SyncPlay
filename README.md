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

Set `OPS_SECRET` in production. Examples:

```bash
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://localhost:3000/api/rooms/cleanup
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://localhost:3000/api/playlist/defaults/refresh
```

Health check: `GET /api/health` (Valkey ping).

Key env vars (see `.env.example`): `VALKEY_URL`, `YTDLP_*`, `OPS_SECRET`, `CONTROL_TOKEN_TTL_SECONDS`, `PROXY_ALLOW_PRIVATE_URLS`, `WS_HEARTBEAT_INTERVAL_MS`, room limits. Fixed in code: WS heartbeat timeout = 3× interval; yt-dlp lock/lease timings from `YTDLP_*`; room TTL 1h; proxy token 7d; coalesce / local-media / HLS cache intervals.

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
