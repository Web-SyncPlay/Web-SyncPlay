# syntax=docker/dockerfile:1

# Build with Bun; run with Node so mediasoup's native worker can spawn reliably.
# Pin base images by digest for supply-chain integrity (OpenSSF Scorecard).
FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
# Skip mediasoup postinstall here: Alpine cannot run the glibc worker binary.
# The mediasoup stage installs against Node/bookworm instead.
# Hoisted linker keeps a Node-resolvable node_modules tree for Next standalone NFT
# (Bun's default isolated layout can omit runtime externals like ws).
RUN bun install --frozen-lockfile --ignore-scripts --linker=hoisted
COPY . .
RUN SKIP_ENV_VALIDATION=true bun run build \
    && mkdir -p /opt/runtime-deps \
    && cp -aL node_modules/ws /opt/runtime-deps/ws

# Install mediasoup on glibc Node. Prefer official prebuilt workers (no compilers).
# Use a committed lockfile so npm ci pins by integrity hash (OpenSSF Scorecard).
FROM node:26-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS mediasoup
WORKDIR /opt/mediasoup

# Keep in sync with package.json / bun.lock and docker/mediasoup/* .
ARG MEDIASOUP_VERSION=3.30.1

# mediasoup picks prebuilts from the *host* kernel via os.release(). Azure
# runners on Linux 7.x download ubuntu-26.04 "kernel7" workers, which fail the
# glibc run-check inside Debian bookworm (exit 1, not the expected 41) and then
# attempt a local rebuild without Python. Pin the ubuntu-22.04 "kernel6"
# worker so bookworm stays compatible on both amd64 and arm64.
# Do not exec the worker during the image build: under BuildKit the exit-41
# probe can fail with broken-pipe / non-41 status even for a good binary.
COPY docker/mediasoup/package.json docker/mediasoup/package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && arch="$(uname -m)" \
    && case "$arch" in \
         x86_64) ms_arch=x64 ;; \
         aarch64) ms_arch=arm64 ;; \
         *) echo "unsupported arch=$arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL -o /tmp/mediasoup-worker.tgz \
         "https://github.com/versatica/mediasoup/releases/download/${MEDIASOUP_VERSION}/mediasoup-worker-${MEDIASOUP_VERSION}-linux-${ms_arch}-kernel6.tgz" \
    && mkdir -p /opt/mediasoup-prebuilt \
    && tar -xzf /tmp/mediasoup-worker.tgz -C /opt/mediasoup-prebuilt \
    && chmod +x /opt/mediasoup-prebuilt/mediasoup-worker \
    && test -x /opt/mediasoup-prebuilt/mediasoup-worker \
    && rm -f /tmp/mediasoup-worker.tgz \
    && printf 'allow-scripts=mediasoup\n' > .npmrc \
    && MEDIASOUP_WORKER_BIN=/opt/mediasoup-prebuilt/mediasoup-worker npm ci --omit=dev \
    && mkdir -p node_modules/mediasoup/worker/out/Release \
    && cp /opt/mediasoup-prebuilt/mediasoup-worker \
         node_modules/mediasoup/worker/out/Release/mediasoup-worker \
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
    && rm -rf /opt/mediasoup-prebuilt /root/.npm /tmp/* \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

FROM node:26-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS runner
WORKDIR /app

ARG TARGETARCH
ARG YTDLP_VERSION=2026.08.19

# Keep these OCI labels aligned with docker/metadata-action labels in
# .github/workflows/ci.yml (title/description/url/docs/authors).
LABEL org.opencontainers.image.title="Web-SyncPlay" \
    org.opencontainers.image.description="Watch any yt-dlp source in sync—or stream local files to everyone" \
    org.opencontainers.image.url="https://web-syncplay.de" \
    org.opencontainers.image.documentation="https://github.com/Web-SyncPlay/Web-SyncPlay#readme" \
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
    ROOM_ACTION_LOG_LIMIT=500 \
    PROXY_ALLOW_PRIVATE_URLS=false

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

# ws is a serverExternalPackage (webpack leaves import("ws")). Bun + Next NFT can
# omit it from standalone; copy a dereferenced tree so /api/ws resolves at runtime.
COPY --from=builder --chown=node:node /opt/runtime-deps/ws ./node_modules/ws
RUN test -f node_modules/ws/package.json && node -e "require('ws')"

# Merge glibc mediasoup (+ its deps) into the standalone node_modules tree.
COPY --from=mediasoup --chown=node:node /opt/mediasoup/node_modules/. ./node_modules/
RUN test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker

USER node
EXPOSE 3000/tcp
EXPOSE 40000/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
