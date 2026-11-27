# syntax=docker/dockerfile:1

# Production dependencies only, installed from the lockfile.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:24-slim
LABEL org.opencontainers.image.title="whatsapp-sound-sticker-bot" \
      org.opencontainers.image.description="WhatsApp bot that turns videos into animated stickers with sound." \
      org.opencontainers.image.source="https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    SESSION_DIR=/data/whatsapp_session \
    OUTPUTS_DIR=/data/outputs \
    HEALTH_FILE=/tmp/sound-sticker-bot/health.json

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src
COPY scripts/healthcheck.js ./scripts/healthcheck.js

# Session and outputs live in /data, owned by the unprivileged "node" user.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
WORKDIR /data

HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "/app/scripts/healthcheck.js"]

STOPSIGNAL SIGTERM
CMD ["node", "/app/index.js"]
