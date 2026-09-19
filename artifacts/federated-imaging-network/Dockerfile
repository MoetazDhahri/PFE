# syntax=docker/dockerfile:1
# Build context must be the repository root (pnpm workspace), e.g.:
#   docker build -f artifacts/federated-imaging-network/Dockerfile \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
#     -t web .

# A glibc-based image is required, not alpine/musl: pnpm-workspace.yaml
# deliberately excludes the musl build of @rollup/rollup-linux-x64-musl
# (the workspace is pinned to Replit's glibc linux-x64 runtime).
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

# vite.config.ts requires PORT/BASE_PATH even for a production build; neither
# affects the built static output, only dev-server behavior, so fixed
# placeholder values are safe here.
ENV PORT=5173
ENV BASE_PATH=/
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PROXY_URL=$VITE_CLERK_PROXY_URL
RUN pnpm --filter federated-imaging-network run build

FROM nginx:alpine AS runtime
COPY --from=build /repo/artifacts/federated-imaging-network/dist/public /usr/share/nginx/html
# .template (not conf.d/default.conf directly): nginx's official image runs
# envsubst on every file here at container startup, substituting
# ${API_BACKEND_HOST} before nginx actually starts — see nginx.conf's
# comment for why this proxy exists at all.
COPY artifacts/federated-imaging-network/nginx.conf /etc/nginx/templates/default.conf.template
ENV API_BACKEND_HOST=api
EXPOSE 8080
