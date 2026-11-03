# ADR-0015: Ukázková verze na GitHub Pages – API běží v prohlížeči

**Stav:** přijato (2026-11-03)

## Kontext

Server pro ostrý provoz zatím není rozhodnutý. Terénní režim (M5) je ale potřeba zkoušet na
iPadu průběžně, přes HTTPS a bez instalace čehokoli. GitHub Pages umí jen statické soubory.

Psát pro ukázku druhou, zjednodušenou verzi serveru by znamenalo dvě sady pravidel, které by se
rozcházely.

## Rozhodnutí

- **Ukázková verze** kanceláře i terénního režimu je na GitHub Pages na adrese `/app/`. QR spike
  zůstává na kořenové adrese.
- **V prohlížeči běží skutečné API**, tedy stejné moduly, služby, validace, chyby a SQL migrace
  jako na serveru:
  - Databáze je **PGlite**, tj. PostgreSQL zkompilovaný do WebAssembly (licence Apache-2.0 /
    PostgreSQL). Data ukládá do IndexedDB prohlížeče.
  - `apps/api/src/demo/router.ts` nahrazuje to málo z Fastify, co moduly používají: routy
    s prefixy, `onRequest` hook, preHandlery, stejný zod validátor a serializér, cookies
    a nahrání jednoho souboru.
  - Seznam modulů je v `src/routes.ts` a mapování chyb v `src/error-response.ts`. Obojí sdílí
    server i ukázka.
- **Web** posílá požadavky přes `src/api/transport.ts`. Ukázkový build (`vite build --mode demo`)
  tento modul vymění za `src/demo/transport.ts`. Do ostrého buildu se tak kód ukázky vůbec
  nedostane.
- **Node moduly**, které API používá, dostanou v ukázce malé náhrady (`apps/web/src/demo/shims`):
  - `node:crypto` (tokeny relací),
  - `@node-rs/argon2` (v ukázce jen SHA-256),
  - `node:util` a `node:path` (pomocné knihovny Fastify),
  - `Buffer` z balíčku `buffer`.
- Web kontroluje typy ukázkového API podle ručně psané deklarace `apps/web/src/demo/api-demo.d.ts`.
  To, že odpovídá skutečnosti, hlídá `apps/api/src/demo/contract.ts` při typové kontrole API.
- **Testy:**
  - `apps/api/src/demo/demo.test.ts` spouští API nad PGlite v Node.
  - `pnpm --filter @revize/web e2e:demo` zkouší ukázkový build v prohlížeči.

## Důsledky

- **Každý prohlížeč má vlastní data.** Spolupráce víc techniků a synchronizace se ukázkou
  vyzkoušet nedají.
- **Přihlášení je jen naoko.** Stránka je veřejná, proto se do ní nesmí zadávat skutečná data
  zákazníků (upozornění je na přihlašovací stránce).
- **Při prvním otevření se stahuje asi 6 MB** (PostgreSQL ve WebAssembly) a databáze se zakládá
  zhruba 5–10 s.
- **Nový modul API se v ukázce objeví sám** (`registerApiRoutes`). Pokud by potřeboval další část
  Fastify nebo Node, demo test ani e2e neprojdou, dokud se nedoplní náhrada.
- **Nezávislost na serveru:** ukázka může zůstat i po spuštění ostrého serveru jako ukázka
  a testovací prostředí.
