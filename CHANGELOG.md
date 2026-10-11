# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - Unreleased

Full rewrite of Web-SyncPlay for operators and users. Themes below summarize `v2.0.1..HEAD`; see [docs/MIGRATION-v3.md](./docs/MIGRATION-v3.md) for a greenfield redeploy checklist.

### Breaking Changes (operators)

- **Stack / runtime:** Bun + Next.js 16 + React 19. Node-only / older Next 13-era deploy recipes do not apply.
- **Port:** HTTP/WebSocket listens on **`3000`** (v2 used **`8081`**). Update reverse proxies and compose port maps.
- **Env:** `REDIS_URL` → **`VALKEY_URL`**. Dropped / removed: **`OPS_SECRET`** and all ops HTTP endpoints. New required/important vars: **`PUBLIC_DOMAIN`**, and for multi-replica local-media HTTP: **`INTERNAL_NODE_BASE_URL`** + **`LOCAL_MEDIA_INTERNAL_SECRET`**.
- **Realtime:** Socket.IO is gone. Custom WebSocket at `/api/ws`. Clients and proxies must speak the new protocol (browser app only; no v2 Socket.IO client compatibility).
- **Room data:** No migration path from v2 Redis room state. Redeploy greenfield; rooms are ephemeral (~**1 hour** TTL).
- **Local media / SFU:** In-process mediasoup SFU on fixed **UDP `40000`** (not configurable). SFU is **process-local** — prefer a single `web` replica for SFU-heavy use. **No TURN**; ICE is STUN-only. Sticky WS alone does not make SFU cluster-safe (UDP must reach the provider’s replica).
- **Rate limits:** Hot WebSocket paths use Valkey token buckets and **fail closed** if Valkey is unhealthy or slow — keep Valkey latency low on WS nodes.
- **Health:** Ops/admin HTTP surfaces removed; use `GET /api/health` for liveness only.

### Added

- **Platform:** Bun toolchain, Next.js App Router, React 19, Valkey-backed state, custom WS realtime.
- **Local media:** Delivery order **SFU → P2P → HTTP relay**; provider-side ABR ladder (ffmpeg.wasm); multi-replica HTTP via internal node URL + secret.
- **Player:** Vidstack-based player; local track switching; audio delay; sync/presence hardening; media prefs in player settings.
- **Embed / control:** Allowlisted site embeds (`EMBED_FRAME_ANCESTORS`, `/room/[id]/embed` with optional `?media=` seed); `/player` and tokenized `/control` surfaces.
- **Ops / images:** Multi-arch Docker images; slim standalone runner; UDP `40000` documented for SFU; compose examples with Valkey.
- **Security / a11y / supply chain:** WCAG 2.2 AAA automated CI gate (`test:a11y`); CodeQL / OpenSSF Scorecard hardening; digest-pinned workflows; property fuzz suite for presence/state invariants.
- **Product UI:** Redesigned landing (room search / URL playability); legal pages (imprint, privacy, terms); default join role (including moderator); room shell / navbar / playlist polish.

### Changed

- Room state is Redis/Valkey-only with TTLs; presence and playlist paths reworked for cluster correctness and lower write storms.
- Local files stay on the provider browser (byte-range relay / WebRTC) instead of server upload.
- Middleware → Next `proxy` convention for CSP/CORS.

### Removed

- Socket.IO realtime stack and v2 client protocol.
- Ops secret–gated HTTP admin/ops endpoints.
- Legacy env knobs superseded by `src/env.ts` / `.env.example` (notably `REDIS_URL`, `OPS_SECRET`).

### Migration

Greenfield redeploy from v2: **[docs/MIGRATION-v3.md](./docs/MIGRATION-v3.md)**.

## [2.0.1] - 2026-04-23

Prior stable line. See git tag `v2.0.1` and historical README at that revision.
