# Architektonická rozhodnutí (ADR)

Každé rozhodnutí, které se později těžko mění, má vlastní soubor `NNNN-nazev.md`
(Kontext → Rozhodnutí → Důsledky). Stav: _navrženo_, _přijato_, _nahrazeno ADR-XXXX_.

| ADR                                            | Název                                                           | Stav                            |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| [0001](0001-monorepo-typescript.md)            | Monorepo, TypeScript, pnpm workspaces                           | přijato                         |
| [0002](0002-backend-fastify-drizzle.md)        | Backend Fastify + Drizzle + PostgreSQL                          | přijato                         |
| [0003](0003-frontend-pwa-platform-adapters.md) | Frontend: jedna React aplikace, PWA, platformní adaptéry        | přijato                         |
| [0004](0004-client-uuids-outbox.md)            | Klientská UUID, online-first s frontou zápisů                   | přijato                         |
| [0005](0005-authentication-sessions.md)        | Autentizace: vlastní, argon2id + DB session                     | přijato                         |
| [0006](0006-dynamic-equipment-fields.md)       | Dynamická pole typů vybavení (JSONB + Zod)                      | přijato                         |
| [0007](0007-file-storage.md)                   | Úložiště fotek za rozhraním `FileStorage`                       | přijato                         |
| [0008](0008-remote-access-https.md)            | HTTPS a vzdálený přístup zdarma                                 | navrženo (rozhodnout před M5)   |
| [0009](0009-qr-scanning.md)                    | Skenování QR: zxing-wasm ve workeru, formát obsahu štítku       | navrženo (podle výsledku spike) |
| [0010](0010-multi-tenancy-permissions.md)      | Příprava na multi-tenant a oprávnění                            | přijato                         |
| [0011](0011-inspection-model.md)               | Model kontroly a hodnocení výsledků                             | přijato                         |
| [0012](0012-item-numbers.md)                   | Čísla artiklů: číselné řady 1–8 číslic, úvodní nuly bez významu | přijato                         |
| [0013](0013-equipment-type-library.md)         | Knihovna typů vybavení podle norem                              | přijato                         |
| [0014](0014-import.md)                         | Import artiklů z XLSX/CSV                                       | přijato                         |
| [0015](0015-demo-in-browser.md)                | Ukázková verze na GitHub Pages – API běží v prohlížeči          | přijato                         |
