# Web-SyncPlay

Watch videos or play music in sync with friends. Unified Next.js app with an embedded WebSocket realtime layer and Valkey-backed room state (1h TTL).

## Stack

- Bun for install/dev; **Node.js** for production runtime (WebSocket upgrade compatibility)
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

## Operator / ops

Set `OPS_SECRET` in production. Examples:

```bash
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://localhost:3000/api/rooms/cleanup
curl -X POST -H "Authorization: Bearer $OPS_SECRET" http://localhost:3000/api/playlist/defaults/refresh
```

Health check: `GET /api/health` (Valkey ping).

Key env vars (see `.env.example`): `VALKEY_URL`, `YTDLP_*`, `OPS_SECRET`, `CONTROL_TOKEN_TTL_SECONDS`, `PROXY_ALLOW_PRIVATE_URLS`, `LOCAL_MEDIA_MAX_BYTES`.

## Production

```bash
docker compose up -d --build
```

### Runbook notes

- Rotate `OPS_SECRET` by updating env and restarting
- Control tokens expire with `CONTROL_TOKEN_TTL_SECONDS` (default 12h); mint again from the room View menu
- Proxy tokens reuse by upstream URL hash; abandoned keys expire (7d sliding TTL)
- Raise `YTDLP_MAX_CONCURRENT` carefully under load; prefer horizontal Valkey + sticky or shared identity keys (already Redis-backed)
