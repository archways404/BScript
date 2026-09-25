# syntax=docker/dockerfile:1
# BScript: API, runner and web UI in one image. Data (SQLite, git mirrors, logs) lives in /data.
ARG NODE_VERSION=22
ARG REGISTRY_VERSION=3.1.2
ARG DOCKER_VERSION=29

# The bundled image registry (CNCF Distribution): a static binary, copied as is.
FROM registry:${REGISTRY_VERSION} AS registry

# Docker CLI and buildx for pipelines that build images. They need a daemon: docker-compose.yml
# mounts the host's socket. Static binaries, copied as is.
FROM docker:${DOCKER_VERSION}-cli AS docker-cli

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# Build the web UI.
FROM base AS web
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter web
COPY apps/web apps/web
RUN pnpm --filter web build

# Server production dependencies only. Build tools are a fallback in case no prebuilt
# better-sqlite3 binary exists for the platform; they stay out of the final image.
FROM base AS server-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter server

FROM node:${NODE_VERSION}-bookworm-slim
# Tools available to pipeline scripts. build-essential and python3 let projects with native
# npm modules (node-gyp) install. Extend this image (FROM bscript) to add more.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash build-essential ca-certificates curl git jq openssh-client python3 tar tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && useradd --create-home --uid 10001 --shell /bin/bash bscript \
 && mkdir -p /data && chown bscript:bscript /data

COPY --from=registry /bin/registry /usr/local/bin/registry
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

WORKDIR /app
COPY --from=server-deps /app/node_modules node_modules
COPY --from=server-deps /app/apps/server/node_modules apps/server/node_modules
COPY package.json ./
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=web /app/apps/web/dist apps/web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Starts as root only to grant access to a mounted Docker socket, then runs as bscript
# (see docker-entrypoint.sh).
ENV NODE_ENV=production \
    BSCRIPT_DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/server/src/index.js"]
