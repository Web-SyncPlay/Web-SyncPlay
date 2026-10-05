FROM oven/bun:1.3.13-alpine AS base
WORKDIR /app

LABEL org.opencontainers.image.url="https://web-syncplay.de" \
    org.opencontainers.image.description="Watch videos or play music in sync with your friends" \
    org.opencontainers.image.title="Web-SyncPlay" \
    maintainer="Yasamato <https://github.com/Yasamato>"

FROM base AS deps

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS builder

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN SKIP_ENV_VALIDATION=true bun run build

# Runtime uses Node.js, not Bun: Bun's node:http compat layer (<=1.3.13) silently
# drops socket.write() inside HTTP `upgrade` handlers (oven-sh/bun#9882, fix in
# unmerged PR #27237), which breaks the WebSocket 101 handshake performed by the
# `ws` library at src/server/ws/transport.ts. `next dev` works on Bun because
# Next.js 16 uses Turbopack's Rust HTTP server in dev, bypassing node:http.
# Once that bug ships in a Bun release, the runtime stage can be collapsed back
# into the Bun image.
FROM node:22-alpine AS runner
WORKDIR /app

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
COPY --from=builder --chown=node:node /app/.next ./.next
COPY package.json next.config.ts ./
COPY public ./public
COPY src/env.js ./src/env.js

USER node
EXPOSE 3000/tcp
CMD ["node", "node_modules/next/dist/bin/next", "start"]
