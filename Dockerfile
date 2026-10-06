# syntax=docker/dockerfile:1

FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

LABEL org.opencontainers.image.url="https://web-syncplay.de" \
    org.opencontainers.image.description="Watch videos or play music in sync with your friends" \
    org.opencontainers.image.title="Web-SyncPlay" \
    org.opencontainers.image.source="https://github.com/Yasamato/Web-SyncPlay" \
    maintainer="Yasamato <https://github.com/Yasamato>"

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS builder
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN SKIP_ENV_VALIDATION=true bun run build

# Bun >= 1.4 ships the node:http upgrade-socket fix (oven-sh/bun#30664), so the
# `ws` handshake in src/server/ws/transport.ts works under Bun in production.
FROM base AS runner

RUN apk add --no-cache yt-dlp

ENV NODE_ENV=production \
    VALKEY_URL=redis://valkey:6379 \
    YTDLP_BIN=yt-dlp \
    YTDLP_MAX_CONCURRENT=2 \
    YTDLP_TIMEOUT_MS=30000 \
    FALLBACK_DEFAULT_MEDIA_URL=https://youtu.be/uD4izuDMUQA \
    ROOM_PARTICIPANTS_LIMIT=100 \
    ROOM_HISTORY_LIMIT=100 \
    ROOM_ACTION_LOG_LIMIT=500 \
    WS_HEARTBEAT_INTERVAL_MS=5000 \
    WS_HEARTBEAT_TIMEOUT_MS=15000 \
    PROXY_ALLOW_PRIVATE_URLS=false \
    CONTROL_TOKEN_TTL_SECONDS=43200

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/.next ./.next
COPY --chown=bun:bun package.json next.config.ts ./
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun src/env.js ./src/env.js

USER bun
EXPOSE 3000/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "run", "start"]
