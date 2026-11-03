# ADR-0014: Import artiklů z XLSX/CSV

**Stav:** přijato (2026-10-28)

## Kontext

Zákazníci mají evidenci v Excelu nebo v CSV z jiných systémů. Každý soubor vypadá jinak:
jiná záhlaví, kódování a oddělovače, umístění v jednom nebo ve více sloupcích. Import nesmí
nechat databázi napůl naplněnou a technik musí před zápisem vidět, co se stane.

## Rozhodnutí

- **Tři kroky:** nahrání (soubor se rozparsuje a uloží do `import_job`), kontrola nanečisto
  (`validate`, nic nezapisuje) a potvrzení (`commit`, jedna transakce, opakovaný commit = 409).
- **Převod buněk a validace řádku** je ve `shared` (`buildRowCandidate`), používá stejné
  schéma polí jako formulář a API (ADR-0006). Server k tomu přidá kontroly proti databázi:
  duplicity v souboru, existující čísla a QR kódy, jiný typ, vyřazené artikly, umístění.
- **Režimy:** _create_ (existující číslo = chyba) a _upsert_ podle čísla artiklu. Prázdná
  buňka při aktualizaci hodnotu nemaže.
- **Umístění** se páruje podle normalizovaných názvů po úrovních, chybějící se volitelně
  založí. Pořadí nového umístění se odvodí z čísla na konci názvu (`Řada 3` → 3).
- **Čísla** se převádějí na kanonický tvar (ADR-0012). Artikly bez čísla dostanou čísla
  za nejvyšším číslem v databázi i v souboru.
- **Mapování** se ukládá podle záhlaví pro každý typ vybavení (`import_mapping`) a příště se
  nabídne samo.
- **CSV:** striktní UTF-8, jinak Windows-1250. Oddělovač se určí počítáním `; , \t |` mimo
  uvozovky v řádku záhlaví. `.xls` se nepodporuje.
- Limity: 10 MB, 20 000 řádků, 200 sloupců.

## Upřesnění 2026-11-03: formáty nejsou tvrdě zamčené

Na přání uživatele import řádek se špatným formátem neodmítne:

- **Čísla** se čtou tolerantně, třeba „2 000 kg“ nebo „cca 2,5 m“. Desetinné číslo v poli pro
  celé číslo se zaokrouhlí.
- **Co nejde převést** (číslo, ano/ne, datum), se uloží jako text a v reportu je varování.
  V kanceláři pak formulář artiklu chce hodnotu opravit, než ho jde uložit.
- **Hodnota mimo číselník** se přijme a při importu se doplní do číselníku typu (audit s názvem
  souboru).
- **Chybějící povinná hodnota** je varování, údaj se doplní v kanceláři.
- **Chybou** (řádek se neimportuje) zůstává jen to, co se týká identity artiklu: neplatné nebo
  duplicitní číslo, obsazený QR kód, jiný typ, neexistující umístění.

## Důsledky

- Rozparsovaný soubor leží v DB (JSONB), takže kontrolu jde opakovat se změněným mapováním bez
  nového nahrání. Staré úlohy je časem potřeba mazat (doplní se s provozními skripty v M9).
- Import do více provozoven nebo typů najednou se dělá jako více importů.
