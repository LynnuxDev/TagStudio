# ========================================
# Optimized Multi-Stage Dockerfile
# Node.js TypeScript Application
# ========================================

ARG NODE_VERSION=22.22.3
FROM node:${NODE_VERSION}-bookworm-slim AS base

WORKDIR /app

# Use the existing node user (uid 1000) from the base image
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# ========================================
# Dependencies Stage (production only)
# ========================================
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod

RUN chown -R node:node /app/node_modules

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

RUN chown -R node:node /app/node_modules

# ========================================
# Build Stage
# ========================================
FROM build-deps AS build

COPY --chown=node:node . .

RUN pnpm build

# ========================================
# Development Stage
# ========================================
FROM build-deps AS development

ENV NODE_ENV=development

COPY --chown=node:node . .

USER node

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

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256 --no-warnings"

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 3000

CMD ["node", "dist/server/index.js"]

# ========================================
# Test Stage
# ========================================
FROM build-deps AS test

ENV NODE_ENV=test

COPY --chown=node:node . .

USER node

CMD ["pnpm", "test"]
