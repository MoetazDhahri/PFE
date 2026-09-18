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

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /repo/artifacts/api-server/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
