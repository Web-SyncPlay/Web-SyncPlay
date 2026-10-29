# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.4] - 2026-10-29

Patch release after `3.0.3`: site footer build metadata, Docker mediasoup/yt-dlp
hardening, and migration of quality gates to Bun builtins.

### Added

- **Footer:** Show app semver, optional build SHA, and image-pinned yt-dlp
  version with links to the matching GitHub / yt-dlp releases (baked at
  `next build` via Docker builder `APP_*` / `YTDLP_VERSION` args).

### Fixed

- **Docker / mediasoup:** Pin the official `kernel6` worker prebuilt for
  bookworm images on kernel7 hosts; skip worker exec during image build so
  CI builders without the mediasoup UDP ports still succeed.
- **Deps:** Bump mediasoup, Next, and yt-dlp (pin `2026.10.26`) for the
  brotli 1.2.1 / CVE-2026-111497 fix path.

### Changed

- **CI / DX:** Replace Prettier, ESLint, and `@typescript/native` with Bun
  `check` / `lint` / `fmt` (`bunfig.toml`); Quality installs floating Bun
  canary until stable ships `bun lint`.
- **Docs:** Document held majors for the Vidstack/dash.js player stack and
  ESLint 10 technical debt.

### Ops

Floating `:3` / `:3.0` track the latest 3.x image from CI; pin `:3.0.4` (or a
digest) for reproducibility.

## [3.0.3] - 2026-10-15

Patch release after `3.0.2`: Action Log redesign, local-media guest playback
hardening, player error/loading fixes, and room/control UI polish.

### Added

- **Action Log:** Faceted category filters, keyword search, density-strip
  overview, expandable rows, and persistent filter state.
- **Control:** Play and pause icons on the transport button.

### Fixed

- **Local media:** Stabilize guest relay playback and landing local check
  (defer viewer-token decoration until join capabilities, progressive MP4 ABR
  default, SW fallthrough until page bridge is ready); probe via `srcObject`
  with safe blob fallback.
- **Player:** Clear sticky errors and surface unplayable media; stop brief
  loading flicker after play and item switch.
- **Playlist:** Keep source URL copy for remote items; label local files by
  sharer device (`username's device`).
- **Room:** Cap player height to 70vh when the rail is open; decode
  percent-encoded room ids for display and URLs.
- **Users:** Condense playback status into an icon+time chip.
- **Control:** Icon-only play styling and seeker cursor; align play/pause
  label and large scrubber height.
- **CI:** Unblock `bun check` (TS7 mock casts) and split Quality / Test / E2E
  jobs with a shared setup action.

### Changed

- **Control:** Tighten scrubber layout across breakpoints (shared
  transport/scrubber row at `sm`; title/clocks into scrubber column on smaller
  sizes).

### Ops

Floating `:3` / `:3.0` track the latest 3.x image from CI; pin `:3.0.3` (or a
digest) for reproducibility.

## [3.0.2] - 2026-10-13

Patch release after `3.0.1`: multi-replica restart recovery, join/snapshot
correctness, player volume and background-tab presence hardening, and room UI
polish (seek scrubber, embed handoff, guest chrome).

### Added

- **Realtime:** Multi-replica restart recovery (drain-aware empty-room destroy,
  readiness via `/api/ready`).
- **Navbar:** Direct player embed button for guests.
- **Users:** Role badge tooltips with promote/demote hints.
- **Control:** Slider-style pill seek scrubber.

### Fixed

- **Join snapshots:** Avoid stale joiner snapshots from presence-only cache;
  invalidate before build so new participants are not omitted.
- **Empty-room destroy:** Re-check presence and `emptyAt` before destroy so a
  concurrent join cannot lose the room (TOCTOU).
- **Player volume:** Keep preferred volume across playlist source changes;
  apply preferred level before `canplay` readiness and ignore provider `0`/`1`
  defaults during a short settling window.
- **Background tabs:** Smoother presence/loading while hidden; resume on focus;
  users list shows “Loading” instead of “Playing” while media is not ready.
- **Embed / room UI:** Unify identity hash handover for player and room popups;
  restore guest chrome, rail height, and YouTube metadata; truncate playing
  title to keep the navbar on one row; clarify guest control hint.
- **Dev / CI:** `next dev` with webpack for ffmpeg.wasm; stop empty-room
  `mock.module` pollution in CI.

### Changed

- Lint cleanup without silencing unused vars; slightly narrower users row.

### Ops

Floating `:3` / `:3.0` track the latest 3.x image from CI; pin `:3.0.2` (or a
digest) for reproducibility. Use `GET /api/ready` (not only `/api/health`) for
load-balancer readiness during rolling restarts.

## [3.0.1] - 2026-10-13

Patch release after `3.0.0`: playback sync hardening, Docker/standalone fixes,
native playlist metadata, and a floating major Docker tag (`3`).

### Added

- **Playlist:** Probe native YouTube/Vimeo title and duration on add (client-side
  embed probe; no yt-dlp).
- **Docker tags:** CI also publishes the major semver tag (`3`) alongside full
  (`3.0.1`) and major.minor (`3.0`).

### Fixed

- **Player sync:** Stop seek/sync loops under high RTT; harden catch-up and seek
  lead; emit pause on intent; native iframe sync; multi-user identity bootstrap;
  empty-state / provider teardown.
- **Native providers:** Skip yt-dlp for YouTube/Vimeo resolves; treat blocked
  CORS probes as unreachable.
- **Docker / standalone:** Ensure `ws` is present in the standalone image for
  `/api/ws`; use webpack for production builds under Next 16.4; standalone
  `bun run start` path.
- **CI:** Restore local-media SW artifact; quality-gate and e2e noise hardening.

### Changed

- Redis TTLs unified in code. Removed operator envs (values are ignored if set):
  `YTDLP_CACHE_TTL_SECONDS`, `CONTROL_TOKEN_TTL_SECONDS`,
  `WS_HEARTBEAT_INTERVAL_MS`.

### Ops

Floating `:3` tracks the latest 3.x image from CI; pin `:3.0.1` (or a digest)
for reproducibility.

## [3.0.0] - 2026-10-11

Full rewrite of Web-SyncPlay for operators and users. Themes below summarize
`v2.0.1`…`v3.0.0`; see [docs/MIGRATION-v3.md](./docs/MIGRATION-v3.md) for a
greenfield redeploy checklist.

### Breaking Changes (operators)

- **Stack / runtime:** Bun + Next.js 16 + React 19. v2 deploy recipes (port
  `8081`, `REDIS_URL`, Socket.IO) do not apply.
- **Port:** HTTP/WebSocket listens on **`3000`** (v2 used **`8081`**). Update
  reverse proxies and compose port maps.
- **Env:** `REDIS_URL` → **`VALKEY_URL`**. Removed: **`OPS_SECRET`** and all ops
  HTTP endpoints. New required/important vars: **`PUBLIC_DOMAIN`**, and for
  multi-replica local-media HTTP: **`INTERNAL_NODE_BASE_URL`** +
  **`LOCAL_MEDIA_INTERNAL_SECRET`**.
- **Realtime:** Socket.IO is gone. Custom WebSocket at `/api/ws`. No v2 Socket.IO
  client compatibility (browser app only).
- **Room data:** No migration path from v2 Redis room state. Redeploy greenfield;
  rooms are ephemeral (~**1 hour** TTL).
- **Local media / SFU:** In-process mediasoup SFU on fixed **UDP `40000`** (not
  configurable). SFU is **process-local** — prefer a single `web` replica for
  SFU-heavy use. **No TURN**; ICE is STUN-only. Sticky WS alone does not make SFU
  cluster-safe (UDP must reach the provider’s replica).
- **Rate limits:** Hot WebSocket paths use Valkey token buckets and **fail
  closed** if Valkey is unhealthy or slow — keep Valkey latency low on WS nodes.
- **Health:** Ops/admin HTTP surfaces removed; use `GET /api/health` for
  liveness only.

### Added

- **Platform:** Bun toolchain, Next.js App Router, React 19, Valkey-backed state,
  custom WS realtime.
- **Local media:** Delivery order **SFU → P2P → HTTP relay**; provider-side ABR
  ladder (ffmpeg.wasm); multi-replica HTTP via internal node URL + secret.
- **Player:** Vidstack-based player; local track switching; audio delay;
  sync/presence hardening; media prefs in player settings.
- **Embed / control:** Allowlisted site embeds (`EMBED_FRAME_ANCESTORS`,
  `/room/[id]/embed` with optional `?media=` seed); `/player` and tokenized
  `/control` surfaces.
- **Ops / images:** Multi-arch Docker images (`websyncplay/websyncplay`); slim
  standalone runner; UDP `40000` documented for SFU; compose examples with
  Valkey.
- **Security / a11y / supply chain:** WCAG 2.2 AAA automated CI gate
  (`test:a11y`); CodeQL / OpenSSF Scorecard hardening; digest-pinned workflows;
  property fuzz suite for presence/state invariants.
- **Product UI:** Redesigned landing (room search / URL playability); legal pages
  (imprint, privacy, terms); default join role (including moderator); room shell /
  navbar / playlist polish.
- **CI e2e:** Password-gated join and local-media HTTP relay coverage in CI
  (`test:e2e:password`, `test:e2e:local-media`). SFU/P2P local-media paths remain
  manual.

### Changed

- Room state is Valkey-only with TTLs; presence and playlist paths reworked for
  cluster correctness and lower write storms.
- Local files stay on the provider browser (byte-range relay / WebRTC) instead of
  server upload.
- Edge middleware → Next `proxy` convention for CSP/CORS.

### Removed

- Socket.IO realtime stack and v2 client protocol.
- Ops secret–gated HTTP admin/ops endpoints.
- Legacy env knobs superseded by `src/env.ts` / `.env.example` (notably
  `REDIS_URL`, `OPS_SECRET`).

### Migration

Greenfield redeploy from v2: **[docs/MIGRATION-v3.md](./docs/MIGRATION-v3.md)**.

## [2.0.1] - 2026-04-23

Prior stable line. See git tag `v2.0.1` and the README at that revision.

[3.0.4]: https://github.com/Web-SyncPlay/Web-SyncPlay/compare/v3.0.3...v3.0.4
[3.0.3]: https://github.com/Web-SyncPlay/Web-SyncPlay/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/Web-SyncPlay/Web-SyncPlay/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/Web-SyncPlay/Web-SyncPlay/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/Web-SyncPlay/Web-SyncPlay/compare/v2.0.1...v3.0.0
[2.0.1]: https://github.com/Web-SyncPlay/Web-SyncPlay/releases/tag/v2.0.1
