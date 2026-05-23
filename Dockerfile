# Stage 1: build frontend
# Use --platform=$BUILDPLATFORM to run on the native runner (fast)
FROM --platform=$BUILDPLATFORM oven/bun:1.3.13-alpine AS frontend

# Wealthfolio Connect configuration (baked into JS bundle at build time)
# Pass via --build-arg to enable; omit to build without Connect.
ARG CONNECT_AUTH_URL=
ARG CONNECT_AUTH_PUBLISHABLE_KEY=
ENV CONNECT_AUTH_URL=${CONNECT_AUTH_URL}
ENV CONNECT_AUTH_PUBLISHABLE_KEY=${CONNECT_AUTH_PUBLISHABLE_KEY}

WORKDIR /app
COPY package.json bun.lock ./
COPY . .
ENV CI=1
ENV BUILD_TARGET=web
RUN bun install --frozen-lockfile
RUN bun run build && mv dist /web-dist

# Final stage: Bun TypeScript backend runtime
FROM oven/bun:1.3.13-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/electron/package.json ./apps/electron/package.json
COPY packages/addon-dev-tools/package.json ./packages/addon-dev-tools/package.json
COPY packages/addon-sdk/package.json ./packages/addon-sdk/package.json
COPY packages/backend-contracts/package.json ./packages/backend-contracts/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --frozen-lockfile --production

COPY apps/backend ./apps/backend
COPY crates/storage-sqlite/migrations ./crates/storage-sqlite/migrations
COPY crates/market-data/src/resolver/exchanges.json ./crates/market-data/src/resolver/exchanges.json
COPY crates/ai/src/ai_providers.json ./crates/ai/src/ai_providers.json
COPY --from=frontend /web-dist ./dist

ENV NODE_ENV=production
ENV WF_DB_PATH=/data/wealthfolio.db
ENV WF_STATIC_DIR=/app/dist

# Wealthfolio Connect API URL (can be overridden at runtime via -e or docker-compose)
ARG CONNECT_API_URL=
ENV CONNECT_API_URL=${CONNECT_API_URL}

# Run as non-root. chown /data BEFORE the VOLUME directive so named volumes
# inherit ownership on first creation. Existing volumes from older images
# need a one-time chown — see docs/self-host/README.md.
RUN addgroup -S -g 1000 wealthfolio \
  && adduser -S -u 1000 -G wealthfolio -H -s /sbin/nologin wealthfolio \
  && mkdir -p /data \
  && chown -R wealthfolio:wealthfolio /data
USER 1000:1000

VOLUME ["/data"]
EXPOSE 8088
CMD ["bun", "apps/backend/src/main.ts"]
