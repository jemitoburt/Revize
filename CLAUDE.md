# CLAUDE.md – Revize

System for inspection technicians: records of customer equipment (racks, ladders, …), field
inspections on iPad (PWA), office administration and exports. Self-hosted, free, open source only.

## Hard constraints

- **No paid services / SaaS.** Everything runs via Docker Compose on the user's own machine.
  Anything that would cost money → stop and ask. External services get an adapter interface,
  with a free local implementation.
- **Licenses:** permissive only (MIT, Apache-2.0, BSD, ISC, PostgreSQL). Anything else must be
  approved first and recorded in `docs/licenses.md`. Approved exceptions: sharp/libvips (LGPL-3.0),
  ExifTool (Artistic/GPL, external process).
- **No field data may be lost.** Every field write goes to IndexedDB before the UI confirms it.
- Decisions that are hard to change later → stop and ask, then record an ADR in `docs/adr/`.

## Language

- UI texts: **Czech**. Code, identifiers, DB names, comments, commits, CLAUDE.md: **English**.
- Docs in `docs/` (ADRs, guides for the user): Czech.

## Repository layout (pnpm workspaces)

- `packages/shared` – domain types, Zod schemas, domain rules. Platform-agnostic: no DOM, no Node APIs.
- `packages/scanner` – framework-agnostic QR scanning core (camera, decode worker, dedupe,
  keyboard-wedge scanner). Used by the spike now and by `apps/web` later.
- `apps/spike-qr` – milestone M1 QR spike (static PWA). GitHub Pages: spike at `/`, app demo at
  `/app/` (`.github/workflows/pages.yml`).
- `apps/api` – Fastify 5 + Zod type provider, Drizzle + node-postgres.
  - `src/modules/<domain>/{routes,service,repository}.ts`; routes validate with schemas from
    `@revize/shared` (they also generate the OpenAPI doc at `/api/docs`).
  - `src/db/schema.ts` is the whole data model; migrations in `drizzle/` (`pnpm --filter
@revize/api db:generate` after schema changes, commit the SQL). Applied on server start.
  - `src/auth/` sessions (cookie or bearer), `requirePermission()`, Origin check for cookie writes.
  - Errors: throw `AppError` helpers from `src/errors.ts` (Czech message + machine code).
  - Every change in a service goes with `recordAudit(tx, …)` in the same transaction.
  - `src/bootstrap.ts` creates org + first admin on an empty DB; `src/seed/demo.ts` demo data.
  - Tests in `test/` hit a real PostgreSQL (fresh database per run, `TEST_DATABASE_URL`).
  - `src/routes.ts` registers every module (server and demo); `src/error-response.ts` maps errors.
  - `src/demo/` runs the same routes on PGlite in the browser for the GitHub Pages demo
    (ADR-0015): a minimal Fastify stand-in (`router.ts`); keep new modules within what it supports
    (routes, onRequest, preHandler, zod schemas, cookies, single-file multipart).
  - Correlated subqueries in `sql` use qualified names (`"customer"."id"`): drizzle renders
    column references without the table, which inside a subquery binds to the inner table.
- `apps/web` – office UI: React 19, Vite, Mantine 9, TanStack Query + Router (code-based routes in
  `src/router.tsx`, Czech URLs). `src/api/hooks.ts` wraps every endpoint; forms map API `issues`
  to fields (`ApiRequestError.fieldErrors()`). Field mode lives in `src/field/` (routes `/teren…`,
  own shell, iPad-sized); platform access (camera, scanner, photos, feedback) only through
  `src/platform/` adapters.
  - Mantine components as router links via `components/links.tsx` (`AnchorLink`, `ButtonLink`).
  - Forms with custom validation use `noValidate`, so every error shows on its field in Czech.
  - Field writes never call the API directly: use the outbox hooks (`useRecordResult`,
    `useUploadPhoto`, `useCreateFieldItem`, …) so that they reach IndexedDB first (ADR-0004).
  - Requests go through `src/api/transport.ts`; `vite build --mode demo` swaps it for
    `src/demo/transport.ts` and aliases Node modules to `src/demo/shims` (ADR-0015).
  - e2e (`apps/web/e2e`) runs the real API on a fresh database (`e2e/start-api.mjs`); Mantine
    selects have the `combobox` role.
- `deploy/` – Caddyfile and the web image (office app at `/`, QR spike at `/spike/`, proxies `/api`).
- `docker-compose.yml` + `.env.example` – db, api, web; `scripts/smoke-test.sh` checks a running stack.
- `docs/` – `architecture.md`, `kancelar.md` (office guide), `teren.md` (field guide), `adr/NNNN-*.md`, `licenses.md`, `provoz.md` (operations, Czech).

## Architecture rules

- IDs are UUIDs and may be generated on the client (offline writes). Write endpoints are idempotent
  (`PUT` with client id).
- Every tenant table has `organization_id` (single org for now). Authorization checks
  **permissions**, never role names directly.
- Dynamic equipment fields: definition stored on `equipment_type`, values in `item.field_values`
  JSONB, validated by the Zod schema built in `packages/shared` (same code on client, API, import).
- Closed inspections are read-only; reopening is audited.
- Infrastructure behind interfaces: `FileStorage`, `PdfRenderer`, `ImageProcessor`, `MetadataWriter`
  (`apps/api/src/infra`); `registerApiRoutes` gets them injected (demo: PGlite files, no PDF).

## Commands

```sh
pnpm install          # install all workspaces
pnpm check            # format:check + lint + typecheck + test (run before every commit)
pnpm test             # vitest (all projects; API tests need PostgreSQL → pnpm db:test)
pnpm db:test          # throwaway PostgreSQL 16 in Docker on :5432 (db:test:stop)
pnpm api:dev          # API with reload on :3000 (apps/api/.env from .env.example)
pnpm --filter @revize/web dev   # office UI on :5173, proxies /api to :3000
pnpm --filter @revize/web e2e   # office e2e: real API on a fresh DB + built UI (needs db:test)
pnpm --filter @revize/web build:demo   # GitHub Pages demo (API in the browser) into dist-demo
pnpm --filter @revize/web e2e:demo     # e2e of the demo build
pnpm typecheck
pnpm lint
pnpm run check:licenses   # dependency license policy (docs/licenses.md)
pnpm spike:dev        # QR spike dev server (camera needs localhost or HTTPS, see apps/spike-qr/README.md)
pnpm spike:build      # static build into apps/spike-qr/dist
pnpm --filter @revize/spike-qr e2e   # Playwright, fake camera feeding a generated QR video
docker compose up -d --build         # whole system (needs .env)
pnpm smoke https://localhost admin@revize.local <heslo>   # smoke test of a running stack
```

## Conventions

- TypeScript strict, ESM, `import type` for types (lint-enforced), Prettier (single quotes, 100 cols).
- Tests next to code as `*.test.ts`. Domain logic in `packages/shared` must be unit-tested.
  Vitest only runs packages that have their own `vitest.config.ts`; Playwright specs live in `e2e/`.
- Playwright is pinned to the preinstalled browser build (`@playwright/test` 1.63.0).
- TypeScript is pinned to 6.0.x until typescript-eslint supports 7.
- API responses never contain secrets; DTO mappers (`toUserDto`…) define what leaves the server.
- Dates leave the API as ISO strings; e-mails are stored trimmed and lower-cased.
- Commits: English, imperative, one milestone step per commit; `pnpm check` must pass.
- After each milestone: update this file, `docs/architecture.md` and add/adjust ADRs.

## Status

- M0 repo skeleton – done.
- M1 QR spike – iteration 2 after the first iPad test (findings in ADR-0009); waiting for round 2
  results (`docs/spike-qr-test-protocol.md`). Decision PWA vs Capacitor pending.
- M2 backend foundation – done: full DB schema + migration, auth (sessions, roles/permissions),
  users, audit, OpenAPI, FileStorage (local disk), Docker Compose stack, demo seed.
- M3 master data – done: API (customers, sites, location tree, equipment types incl. standards
  library, items with bulk updates) and office UI. Item number = číslo TZ (4–5 digits, unique in
  the organization) + optional designation unique per site (`designation_key`, ADR-0012).
- M4 import – done: upload (XLSX via exceljs, CSV via papaparse with UTF-8/cp1250 and delimiter
  detection) → mapping (suggested from headers, remembered per type) → dry-run report per row →
  commit in one transaction (ADR-0014). Row conversion/validation lives in `packages/shared/src/import`.
- M5 field mode online – done: GitHub Pages demo with the API running in the browser on PGlite
  (ADR-0015); inspections, idempotent results ("later recordedAt wins"), photos with thumbnails
  (ADR-0007, ADR-0011); field UI (list by location, scanner, number pad, keyboard-wedge, item card,
  photos, new item). Guide: `docs/teren.md`.
- Deployment – done: `docs/provoz.md` (Caddy+LE or behind a proxy), `scripts/backup.sh`,
  `restore.sh`, `test-restore.sh` (runs in CI). The user has a server; hosting details pending.
- M6 offline – done (ADR-0004 "Provedení"): GET snapshots in IndexedDB (`api/client.ts`), field
  writes through the outbox (`src/offline/outbox.ts`, groups per item/inspection, attention state,
  draft defect photos), overlay of pending changes, service worker (prompted updates), sync badge
  with emergency ZIP export; e2e `e2e/field/offline.spec.ts`; web unit tests (`vitest.config.ts`,
  fake-indexeddb).
- M7 (part 1) – done: close (next dates per checked item) / reopen (reason, audit), organization
  settings + logo (`settings.manage`), protocol HTML in shared (`renderProtocolHtml`, ADR-0016),
  PDF via `PdfRenderer` (Chromium/playwright-core; `CHROMIUM_PATH`), office pages Kontroly and
  Nastavení. Layout follows the user's protocol form (`docs/vzory/`, ADR-0016): PDF page
  header/footer as Chromium templates, ANO/NE table, the form's texts per type; risk levels after
  ČSN EN 15635 (zelená/žlutá/červená, `SEVERITY_LABELS`).
- Dokploy variant merged (PR vitekdynka-debug/Revize#1): `docker-compose.dokploy.yml`, DB password
  apart from the URL (`DATABASE_PASSWORD`), CPU/RAM/log limits and `STORAGE_MAX_GB` for files.
- M7 part 2 – done (ADR-0017): `GET /inspections/:id/export.xlsx|export.csv|photos.zip`; table
  logic in `packages/shared/src/export.ts`; ZIP streamed with fflate (web `ReadableStream`, the
  demo router collects it); `MetadataWriter` = ExifTool via exiftool-vendored (Perl in the API
  image), demo `noMetadataWriter`. Users can be deleted (soft delete, `deleted_at`).
- Risk levels only for racks (ADR-0018): `equipment_type.risk_levels`; other types fit / unfit
  (unfit stored as red); `inspection_result.photos_in_protocol` (field + office checkbox).
  Photos can be turned/cropped right after capture (`field/PhotoEditor.tsx`).
- Intervals (ADR-0019): `inspection_interval_months` on site, location and item; item → nearest
  location → site → type (`inspectionIntervalOf`, API `effectiveIntervals`); close uses it.
  Technician authorization per user (`app_user.certification`); database export with history.
- M8 history and filters – done: `GET /items/:id/history` (inspections of the site that covered
  the item, result or not checked), item list and database export filters `due`
  (overdue/30/60/90) and `lastInspection=unchecked` (`itemStateFilters`), history in the item
  drawers; merging equipment types (`POST /equipment-types/merge`, `planTypeMerge`).
- Next: audit view in the office (optional); M1 decision PWA vs Capacitor.
