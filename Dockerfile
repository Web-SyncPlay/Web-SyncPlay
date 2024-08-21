# Install dependencies only when needed
FROM oven/bun:1.1.24-alpine AS deps
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --production --frozen-lockfile

# Rebuild the source code only when needed
FROM node:22.6-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm build

# Production image, copy all the files and run next
FROM node:22.6-alpine AS runner
WORKDIR /app

ENV NODE_ENV="production"
ENV SITE_NAME="Web-SyncPlay"
ENV PUBLIC_DOMAIN="https://web-syncplay.de"
ENV REDIS_URL="redis://redis:6379"

EXPOSE 3000

LABEL org.opencontainers.image.url="https://web-syncplay.de" \
    org.opencontainers.image.description="Watch videos or play music in sync with your friends" \
    org.opencontainers.image.title="Web-SyncPlay" \
    maintainer="Yasamato <https://github.com/Yasamato>"

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 && \
    apk add --no-cache curl python3 py3-pip &&  \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# You only need to copy next.config.js if you are NOT using the default configuration
# COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8081

ENV PORT=8081

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry.
# ENV NEXT_TELEMETRY_DISABLED 1

CMD ["sh", "-c", "node server.js"]
