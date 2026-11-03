# Static front ends served by Caddy, which also proxies /api to the API container:
#   /        office application (apps/web)
#   /spike/  QR spike PWA (apps/spike-qr), for testing the scanner against this server
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
# Workspace dependency of the web app (only its demo build uses it, see ADR-0015).
COPY apps/api/package.json apps/api/
COPY apps/spike-qr/package.json apps/spike-qr/
COPY packages/shared/package.json packages/shared/
COPY packages/scanner/package.json packages/scanner/
RUN pnpm install --frozen-lockfile --filter @revize/web... --filter @revize/spike-qr...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
COPY apps/spike-qr apps/spike-qr
RUN pnpm --filter @revize/web build \
 && BASE_PATH=/spike/ pnpm --filter @revize/spike-qr build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
COPY --from=build /repo/apps/spike-qr/dist /srv/spike
