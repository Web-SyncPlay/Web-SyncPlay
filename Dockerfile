# syntax=docker/dockerfile:1

# Build with Bun; run with Node so mediasoup's native worker can spawn reliably.
# Pin base images by digest for supply-chain integrity (OpenSSF Scorecard).
FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
# Skip mediasoup postinstall here: Alpine cannot run the glibc worker binary.
# The mediasoup stage installs against Node/bookworm instead.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN SKIP_ENV_VALIDATION=true bun run build

# Install mediasoup on glibc Node. Prefer official prebuilt workers (no compilers).
FROM node:26-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3 AS mediasoup
WORKDIR /opt/mediasoup

# mediasoup version must stay in sync with bun.lock / package.json.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm init -y >/dev/null \
    && printf 'allow-scripts=mediasoup\n' > .npmrc \
    && npm install mediasoup@3.28.0 --omit=dev --no-save \
    && test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker \
    && cd node_modules/mediasoup \
    && rm -rf \
         worker/deps \
         worker/src \
         worker/include \
         worker/fuzzer \
         worker/test \
         worker/subprojects \
         worker/fbs \
         worker/scripts \
         worker/mocks \
         worker/pip_invoke \
         worker/prebuild \
         worker/out/Debug \
         worker/Makefile \
         worker/meson.build \
         worker/meson_options.txt \
         worker/tasks.py \
         npm-scripts.mjs \
         README.md \
         CHANGELOG.md \
    && rm -f /opt/mediasoup/.npmrc \
    && rm -rf /root/.npm /tmp/*

FROM node:26-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3 AS runner
WORKDIR /app

ARG TARGETARCH
ARG YTDLP_VERSION=2026.08.19

# Keep these OCI labels aligned with docker/metadata-action labels in
# .github/workflows/ci.yml (title/description/url/docs/authors).
LABEL org.opencontainers.image.title="Web-SyncPlay" \
    org.opencontainers.image.description="Watch any yt-dlp source in sync—or stream local files to everyone" \
    org.opencontainers.image.url="https://web-syncplay.de" \
    org.opencontainers.image.documentation="https://github.com/Yasamato/Web-SyncPlay#readme" \
    org.opencontainers.image.source="https://github.com/Yasamato/Web-SyncPlay" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.authors="Yasamato <https://github.com/Yasamato>"

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
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

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && case "$TARGETARCH" in \
         amd64) YTDLP_ASSET=yt-dlp_linux ;; \
         arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; \
         *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
       esac \
    && curl -fsSL -o /usr/local/bin/yt-dlp \
         "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}" \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir -p .next && chown node:node .next

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Merge glibc mediasoup (+ its deps) into the standalone node_modules tree.
COPY --from=mediasoup --chown=node:node /opt/mediasoup/node_modules/. ./node_modules/
RUN test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker

USER node
EXPOSE 3000/tcp
EXPOSE 40000/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
