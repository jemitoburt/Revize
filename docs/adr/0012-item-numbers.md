# ADR-0012: Čísla artiklů (číslo TZ) a označení

**Stav:** přijato (2026-10-26), nahrazuje původní předpoklad pevně pětimístného čísla

## Kontext

V jednom provozu bývají vedle sebe číselné řady různé délky, typicky čtyřmístná a pětimístná.
Technik chce na číselníku zadávat rychle a vyhledání má proběhnout bez potvrzování.

## Rozhodnutí

- Číslo artiklu tvoří **jen číslice, 1–8 znaků**.
- **Úvodní nuly se nepočítají:** `01234` je totéž co `1234`. Ukládá se **kanonický tvar bez
  úvodních nul** (`canonicalItemNumber()` ve `shared`). DB vynucuje `^[1-9][0-9]{0,7}$`
  a unikátnost `(customer_id, item_number)`. Migrace `0002` převede existující čísla.
- **Číselník:** po 5. číslici se artikl otevře sám, pokud existuje. Čtyřmístná čísla technik
  zadá s nulou na začátku (`04001`). Kratší i delší čísla potvrdí tlačítkem OK.
- **Skenování:** čistě číselný obsah QR kódu nebo čtečky se nejdřív hledá jako QR kód artiklu
  a potom jako číslo artiklu.
- **Řazení** čísel je číselné (`compareItemNumbers`), takže `999` je před `1000`.

## Důsledky

- Pokud by někde existovala řada, kde úvodní nuly něco znamenají (`00123` a `123` jako dva
  různé artikly), tento model ji nepodporuje. Taková řada by se musela evidovat přes QR kód
  nebo s jiným prefixem.
- Import (M4) převede čísla na kanonický tvar a duplicity nahlásí po řádcích.

## Změna 2026-11-03: číslo TZ a označení

Na přání uživatele (rozhodnutí v chatu):

- **Číslo TZ** (dosavadní číslo artiklu) má **4 nebo 5 číslic** a je **unikátní v celé
  evidenci**, ne jen u zákazníka. Úvodní nuly dál nemají význam. Automaticky přidělené číslo je
  další po nejvyšším čísle TZ organizace, nejméně 1000.
- **Označení** (`item.designation`) je nepovinný text, např. „Ž-01“. U regálu předvolba obvykle
  označuje místo v hale („A1-12“). V provozovně je **unikátní** mezi artikly v evidenci (vyřazený
  artikl označení uvolní). Porovnává se bez ohledu na velikost písmen, mezery, pomlčky, tečky
  a lomítka (`normalizeDesignation`, sloupec `designation_key`), takže „Ž-01“ = „ž 01“.
- **Vyhledávání:** v terénu i v kanceláři podle čísla TZ i podle označení. Skener a čtečka
  hledají QR kód, potom číslo TZ, potom označení.
- **Import:** sloupec „Označení“ jde namapovat. Při aktualizaci existujících artiklů se řádek
  bez čísla TZ spáruje podle označení v provozovně. Číslo TZ jiného zákazníka je chyba.
- **Migrace `0010`:** pokud stávající data mají stejné číslo u dvou zákazníků, unikátní index
  v celé evidenci se zatím nevytvoří (zapíše se varování). API ale nové duplicity odmítá.
  Starší čísla delší než 5 číslic zůstávají platná.
