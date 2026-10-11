# Migrating from v2 to v3

v3 is a **full rewrite**. Treat the upgrade as a **greenfield redeploy**, not an in-place config tweak. There is **no migration of v2 room data** (Redis keys, Socket.IO sessions, or uploaded local files).

For release themes and the operator Breaking Changes list, see [CHANGELOG.md](../CHANGELOG.md). For day-to-day deploy details, see the root [README.md](../README.md).

## Checklist

1. Stop the v2 stack (containers / process on port **8081**).
2. Deploy a fresh v3 image or build from this repo with a new `.env` (copy [`.env.example`](../.env.example)).
3. Point DNS / reverse proxy at **HTTP `3000`** (and WebSocket upgrade on the same origin path `/api/ws`).
4. Expose **UDP `40000`** to the `web` process if you want mediasoup SFU for local files.
5. Recreate rooms in the UI; tell users bookmarks to `:8081` must move to the new origin.

## Environment mapping

| v2 | v3 | Notes |
| -- | -- | ----- |
| `REDIS_URL` | `VALKEY_URL` | Same Redis protocol URL shape (`redis://…`). Compose typically uses `redis://valkey:6379`. |
| Port **8081** | Port **3000** | App + WebSocket. Prefer TLS termination on 443 in front. |
| Socket.IO | Custom WS `/api/ws` | No Socket.IO server or client. Proxies must allow WebSocket upgrade on `/api/ws`. |
| `OPS_SECRET` / ops HTTP | *removed* | No ops admin HTTP API. Use `GET /api/health` for liveness only. |
| *(often unset)* | `PUBLIC_DOMAIN` | Public hostname or origin. Drives ICE `announcedAddress`, CORS, CSP. Required for real deployments; omit only for localhost-only use. |
| *(n/a)* | `INTERNAL_NODE_BASE_URL` + `LOCAL_MEDIA_INTERNAL_SECRET` | Set **both** on every `web` replica if you need cross-replica local-media **HTTP** relay. Per-replica base URL (not shared service DNS). Keep internal routes off public ingress. |
| *(n/a)* | `EMBED_FRAME_ANCESTORS` | Optional; required to iframe `/embed` from other origins. |

Empty strings are treated as unset. Schema: [`src/env.ts`](../src/env.ts).

## What does not carry over

- **Room state** — v2 Redis/room documents are not read. Rooms expire after ~**1 hour** of TTL-based lifecycle in v3.
- **Socket.IO clients / bots** — must be rewritten against the v3 browser app protocol (not a supported external API surface for v2 parity).
- **Local file uploads stored on the server** — v3 keeps bytes on the sharer’s browser (SFU / P2P / HTTP relay).
- **Ops tooling** that called secret-gated ops endpoints — those routes are gone.

## Networking & media (operators)

| Topic | v3 expectation |
| ----- | -------------- |
| SFU | In-process mediasoup; **UDP `40000` fixed** (not configurable). Process-local routers/transports/WS registry. |
| Replicas | Prefer a **single `web` replica** for SFU-heavy deployments. Multiple replicas cannot share one host’s UDP `40000` without per-pod/host mapping. |
| Sticky WebSocket | Sticky `/api/ws` helps co-locate signaling with the provider, but **sticky WS ≠ cluster-safe SFU** — UDP must still hit the provider’s replica. |
| TURN | **None.** ICE is STUN-only (Google + Cloudflare). UDP-blocked clients fall back to HTTP local-media relay, not SFU. |
| Rate limits | Hot WS paths rate-limit via Valkey and **fail closed** on Redis/Valkey errors. |

Details and proxy snippets: [README → Multi-replica operations (SFU)](../README.md#multi-replica-operations-sfu).

## Minimal compose shape

```yaml
services:
  web:
    image: websyncplay/websyncplay:latest  # or your build
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
    # healthcheck as in README
```

Do **not** keep `REDIS_URL`, `OPS_SECRET`, or `8081:8081` from a v2 compose file without rewriting them as above.
