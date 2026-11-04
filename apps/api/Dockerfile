# Build context: repository root (see docker-compose.yml).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @revize/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @revize/api build \
 && date -u '+%Y-%m-%dT%H:%M:%SZ' > apps/api/dist/build-time.txt \
 && pnpm --filter @revize/api deploy --legacy --prod /out

FROM node:22-alpine
# Chromium prints the PDF protocols; Noto fonts cover Czech diacritics; Perl runs ExifTool
# (exiftool-vendored) for the metadata of exported photos.
RUN apk add --no-cache chromium font-noto perl \
 && ln -s "$(command -v chromium-browser || command -v chromium)" /usr/local/bin/revize-chromium
ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/local/bin/revize-chromium \
    MIGRATIONS_DIR=/app/drizzle \
    FILES_DIR=/data/files \
    PORT=3000
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD wget -q -Y off -O- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
