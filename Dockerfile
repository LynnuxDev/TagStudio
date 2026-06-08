# ========================================
# Optimized Multi-Stage Dockerfile
# Node.js TypeScript Application
# ========================================

ARG NODE_VERSION=22.22.3
FROM node:${NODE_VERSION}-bookworm-slim AS base

WORKDIR /app

RUN groupadd -g 1001 -r nodejs && \
    useradd -r -u 1001 -g nodejs -d /app -s /sbin/nologin nodejs

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# ========================================
# Dependencies Stage (production only)
# ========================================
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod

RUN chown -R nodejs:nodejs /app/node_modules

# ========================================
# Build Dependencies Stage (all deps)
# ========================================
FROM base AS build-deps

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 \
      gcc \
      g++ \
      make \
      && rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

RUN chown -R nodejs:nodejs /app/node_modules

# ========================================
# Build Stage
# ========================================
FROM build-deps AS build

COPY --chown=nodejs:nodejs . .

RUN pnpm build

# ========================================
# Development Stage
# ========================================
FROM build-deps AS development

ENV NODE_ENV=development

COPY --chown=nodejs:nodejs . .

USER nodejs

EXPOSE 3000 5173 9229

CMD ["pnpm", "dev"]

# ========================================
# Production Stage
# ========================================
FROM node:${NODE_VERSION}-bookworm-slim AS production

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      p7zip-full \
      && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN groupadd -g 1001 -r nodejs && \
    useradd -r -u 1001 -g nodejs -d /app -s /sbin/nologin nodejs

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256 --no-warnings"

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/package.json ./
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist

RUN mkdir -p /data && chown -R nodejs:nodejs /data

USER nodejs

EXPOSE 3000

CMD ["node", "dist/server/index.js"]

# ========================================
# Test Stage
# ========================================
FROM build-deps AS test

ENV NODE_ENV=test

COPY --chown=nodejs:nodejs . .

USER nodejs

CMD ["pnpm", "test"]
