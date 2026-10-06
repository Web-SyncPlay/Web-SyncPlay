# syntax=docker/dockerfile:1

FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

# https://nextjs.org/telemetry
ENV NEXT_TELEMETRY_DISABLED=1

LABEL org.opencontainers.image.title="Web-SyncPlay" \
    org.opencontainers.image.description="Watch any yt-dlp source in sync—or stream local files to everyone" \
    org.opencontainers.image.url="https://web-syncplay.de" \
    org.opencontainers.image.documentation="https://github.com/Yasamato/Web-SyncPlay#readme" \
    org.opencontainers.image.source="https://github.com/Yasamato/Web-SyncPlay" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.authors="Yasamato <https://github.com/Yasamato>"

FROM base AS builder
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN SKIP_ENV_VALIDATION=true bun run build

# Bun >= 1.4 ships the node:http upgrade-socket fix (oven-sh/bun#30664), so the
# `ws` handshake in src/server/ws/transport.ts works under Bun in production.
FROM base AS runner

ARG TARGETARCH
# Pin for reproducible builds; bump when upgrading yt-dlp.
ARG YTDLP_VERSION=2026.08.19

RUN apk add --no-cache ca-certificates \
    && case "$TARGETARCH" in \
         amd64) YTDLP_ASSET=yt-dlp_musllinux ;; \
         arm64) YTDLP_ASSET=yt-dlp_musllinux_aarch64 ;; \
         *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
       esac \
    && wget -qO /usr/local/bin/yt-dlp \
         "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}" \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    VALKEY_URL=redis://valkey:6379 \
    YTDLP_BIN=yt-dlp \
    YTDLP_MAX_CONCURRENT=2 \
    YTDLP_TIMEOUT_MS=30000 \
    FALLBACK_DEFAULT_MEDIA_URL=https://youtu.be/uD4izuDMUQA \
    ROOM_PARTICIPANTS_LIMIT=100 \
    ROOM_HISTORY_LIMIT=100 \
    ROOM_ACTION_LOG_LIMIT=500 \
    WS_HEARTBEAT_INTERVAL_MS=5000 \
    PROXY_ALLOW_PRIVATE_URLS=false \
    CONTROL_TOKEN_TTL_SECONDS=43200

COPY --from=builder --chown=bun:bun /app/public ./public
RUN mkdir -p .next && chown bun:bun .next

# File-traced server only — excludes .next/cache and unused node_modules.
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static

# Drop glibc-only native bindings if the tracer ever includes them on Alpine.
RUN rm -rf \
      ./node_modules/@next/swc-linux-x64-gnu \
      ./node_modules/@img/sharp-libvips-linux-x64 \
      ./node_modules/@img/sharp-linux-x64 \
    && find ./node_modules -type d \( \
         -name 'swc-linux-x64-gnu' -o \
         -name 'sharp-libvips-linux-x64' -o \
         -name 'sharp-linux-x64' \
       \) -prune -exec rm -rf {} + 2>/dev/null || true

USER bun
EXPOSE 3000/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "server.js"]
