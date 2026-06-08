FROM node:22-bookworm-slim AS build

RUN npm install -g pnpm@10

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 \
      gcc \
      g++ \
      make \
      && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src/ ./src/

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      p7zip-full \
      && rm -rf /var/lib/apt/lists/*

RUN groupadd -r tagger && useradd -r -g tagger -d /app -s /sbin/nologin tagger

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

RUN npm install -g pnpm@10 && \
    pnpm install --frozen-lockfile --prod && \
    rm -rf /root/.local/share/pnpm

RUN mkdir -p /data && chown tagger:tagger /data

USER tagger

EXPOSE 3000

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

CMD ["node", "dist/server/index.js"]
