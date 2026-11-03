# ADR-0004: Klientská UUID, online-first s frontou zápisů (outbox)

**Stav:** přijato (2026-10-26)

## Kontext

iPad je online zhruba v 95 % případů. Žádná data pořízená v terénu se nesmí ztratit, ani při
zavření aplikace, a opakované odeslání nesmí vytvořit duplicity.

## Rozhodnutí

- Všechna ID jsou UUID (v7, časově řaditelná) a generuje je i klient.
- **Cache** (Dexie/IndexedDB): snapshot zákazníka při zahájení kontroly, potom delta podle `updated_at`.
- **Outbox** v IndexedDB: příkaz `{id, kind, entityId, payload, dependsOn[], attempts, status,
lastError}`, fotky jako Bloby. Zápis do outboxu proběhne před potvrzením v UI.
- Idempotentní endpointy: `PUT` s klientským ID (upsert, stejný obsah = 200 bez změny). Výsledek
  kontroly je unikátní pár (kontrola, artikl); při souběhu vyhrává novější `recorded_at` a
  přepsaná verze jde do auditu.
- Odesílání FIFO se závislostmi, exponenciální backoff (1 s → 5 min). Spouští se po přidání do
  fronty, při události `online`, při návratu do aplikace a periodicky. Background Sync API iOS
  nepodporuje.
- Chyby: síť nebo 5xx → opakovat. 4xx → stav „vyžaduje pozornost“, data se **nikdy nemažou**.
  401 frontu pozastaví.
- Pojistky: `navigator.storage.persist()`, indikátor počtu neodeslaných položek, varování
  při odhlášení a nouzový export neodeslaných dat do ZIPu.
- Číslo nového artiklu offline se vezme z bloku rezervovaného předem (`item_number_lease`).
  Když blok dojde, artikl dostane dočasné označení a číslo mu přidělí server.

## Provedení (M6, 2026-11-03)

- **Čtení:** odpovědi, které terén potřebuje (`/auth/me`, kontroly, seznam artiklů kontroly, typy,
  zákazníci, provozovny, umístění, seznamy fotek), se při každém úspěšném načtení uloží do IndexedDB
  (`apps/web/src/api/client.ts`). Bez připojení se použije uložená kopie. Seznam kontroly se tedy
  stáhne při otevření kontroly online. Samostatné „stahování zákazníka“ ani delta podle
  `updated_at` nejsou potřeba.
- **Zápisy:** výsledek, zrušení výsledku, fotka a nový artikl jdou do outboxu
  (`apps/web/src/offline/outbox.ts`). Seznam kontroly ukazuje stav serveru s neodeslanými změnami
  nahoře (`overlay.ts`).
  - Závislosti se řeší skupinami: vše k jednomu artiklu (`item:<id>`) a k jedné kontrole
    (`inspection:<id>`) se posílá přísně v pořadí. Ostatní skupiny tím nečekají (`runnableCommands`
    ve `shared`).
  - Backoff je 2 s → 5 min. Příkaz, který server odmítne (4xx), čeká na technika („vyžaduje
    pozornost“, „Zkusit znovu“) a blokuje jen svou skupinu.
  - Fotka závady pořízená před uložením výsledku se hned uloží do zařízení jako koncept a do fronty
    se zařadí až za výsledek.
  - Příkazy si pamatují uživatele. Po přihlášení jiného uživatele se neodešlou pod jeho jménem.
- **Service worker** (vite-plugin-pwa) ukládá jen aplikaci, aby se otevřela bez sítě. Data API
  neukládá. Nová verze se nainstaluje až po klepnutí na „Aktualizovat“.
- **Bez připojení nejde:** zahájit novou kontrolu (rozsah artiklů určuje server), smazat fotku,
  která už je na serveru, a přihlásit se.
- **Odchylka od plánu, čísla artiklů:** rezervované bloky (`item_number_lease`) zatím nejsou.
  - Technik může číslo zadat sám (štítek na místě). Duplicitu v provozovně zkontroluje už zařízení.
  - Bez čísla se artikl zobrazí jako „nový“ a server mu přidělí další volné číslo při odeslání.
  - Bloky se doplní, kdyby bylo potřeba znát čísla už v terénu bez signálu.

## Důsledky

- Plná offline-first synchronizace (CRDT, obousměrné konflikty) se nedělá. Pokud bude potřeba,
  outbox zůstane a doplní se stahování změn.
