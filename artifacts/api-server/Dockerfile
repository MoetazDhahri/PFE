# syntax=docker/dockerfile:1
# Build context must be the repository root (pnpm workspace), e.g.:
#   docker build -f artifacts/api-server/Dockerfile -t api-server .

# A glibc-based image is required, not alpine/musl: pnpm-workspace.yaml
# deliberately excludes musl builds of rollup/lightningcss (the workspace is
# pinned to Replit's glibc linux-x64 runtime), which the shared workspace
# install step below resolves against even though this service doesn't use
# them directly.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build
# onnxruntime-node and sharp are native addons, externalized from the
# esbuild bundle (see build.mjs) — esbuild leaves a real require() for
# them, so their actual package files must exist on disk at runtime.
# `pnpm deploy` (not a manual node_modules copy) correctly resolves this
# monorepo's pnpm symlinks into a flat, self-contained, prod-only folder —
# a manual copy of node_modules/.pnpm leaves symlinks pointing at relative
# paths that no longer exist once the directory layout changes.
RUN pnpm --filter @workspace/api-server deploy --prod /deploy

# Must also be glibc (node:24-slim, not -alpine): onnxruntime-node/sharp's
# prebuilt native binaries are resolved against the build stage's glibc,
# and an alpine/musl runtime can't load them (the same class of mismatch
# as the rollup/lightningcss issue documented in the repo root README).
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /repo/artifacts/api-server/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
