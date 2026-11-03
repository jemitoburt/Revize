# Licence

Projekt smí používat jen software s permisivní licencí (MIT, Apache-2.0, BSD, ISC,
PostgreSQL, BlueOak, CC0). Každá výjimka musí být schválená a zapsaná tady.
Kontrolu dělá `pnpm run check:licenses` (skript `scripts/check-licenses.mjs`), spouští se i v CI.

## Hlavní komponenty

| Komponenta                                 | Licence                         | Použití                           | Fáze   |
| ------------------------------------------ | ------------------------------- | --------------------------------- | ------ |
| TypeScript, Vite, Vitest, ESLint, Prettier | Apache-2.0 / MIT                | build a testy                     | M0     |
| zxing-wasm (wrapper) + zxing-cpp           | MIT + Apache-2.0                | dekódování QR v prohlížeči        | M1     |
| qrcode (node-qrcode)                       | MIT                             | testovací arch QR, později štítky | M1     |
| vite-plugin-pwa, Workbox                   | MIT                             | service worker, PWA               | M1     |
| Playwright                                 | Apache-2.0                      | e2e testy, později render PDF     | M1     |
| Chromium (přes Playwright)                 | BSD-3-Clause a další permisivní | headless render PDF               | M7     |
| Fastify, @fastify/*                        | MIT                             | API                               | M2     |
| Drizzle ORM, drizzle-kit                   | Apache-2.0                      | ORM, migrace                      | M2     |
| PostgreSQL                                 | PostgreSQL                      | databáze                          | M2     |
| @node-rs/argon2                            | MIT                             | hash hesel                        | M2     |
| React, TanStack, Mantine, Dexie            | MIT / Apache-2.0                | frontend                          | M3     |
| exceljs, papaparse, archiver               | MIT                             | import XLSX/CSV, export, ZIP      | M4, M7 |
| PGlite (@electric-sql/pglite)              | Apache-2.0 / PostgreSQL         | ukázková verze v prohlížeči       | M5     |
| @noble/hashes, buffer                      | MIT                             | náhrady Node modulů v ukázce      | M5     |
| Caddy                                      | Apache-2.0                      | reverse proxy, HTTPS              | M2     |
| Noto Sans (fonty)                          | OFL-1.1                         | písmo PDF protokolu               | M7     |

## Schválené výjimky

| Balíček                                          | Licence                 | Proč je to v pořádku                                                                                                                                                       | Schváleno                                 |
| ------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| sharp → `@img/sharp-libvips-*`                   | LGPL-3.0-or-later       | libvips je dynamicky linkovaná knihovna a provozujeme ji sami (self-hosting, nic nešíříme). sharp samotný má Apache-2.0.                                                   | uživatel, 2026-10-26                      |
| ExifTool (přes `exiftool-vendored`, MIT wrapper) | Artistic-1.0 / GPL-1.0+ | Spouští se jako samostatný proces, nelinkuje se.                                                                                                                           | uživatel, 2026-10-26                      |
| `lightningcss`                                   | MPL-2.0                 | Tranzitivní závislost Vite 8, používá se jen při buildu CSS a do aplikace se nedostane. MPL je slabý copyleft na úrovni souborů a týká se jen úprav samotné knihovny.      | evidováno 2026-10-26, nahlášeno uživateli |
| `caniuse-lite`                                   | CC-BY-4.0               | Data o podpoře v prohlížečích, potřebná jen při buildu.                                                                                                                    | evidováno 2026-10-26, nahlášeno uživateli |
| `buffers` 0.1.1 (exceljs → unzipper → binary)    | neuvedena               | Malá pomocná knihovna (autor substack) bez licence v balíčku. Používá ji jen čtení XLSX v API. Kdyby nebyla schválena, nahradí se čtení XLSX jinou knihovnou (`parse.ts`). | evidováno 2026-10-28, nahlášeno uživateli |

Permisivní licence mimo základní sadu: `jszip` (MIT OR GPL-3.0, používáme pod MIT), `pako`
(MIT a Zlib), `chainsaw` (MIT/X11). Všechny jsou tranzitivní závislosti exceljs.

## Nástroje mimo aplikaci

`pg_dump`/`pg_restore` (PostgreSQL) a `rsync` (GPL-3.0) se v zálohovacích skriptech volají jako
samostatné programy. S aplikací se nelinkují ani se s ní nešíří.
