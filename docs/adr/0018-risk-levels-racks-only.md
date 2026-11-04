# ADR-0018: Barvy rizika jen u regálů, jinde Vyhovuje / Nevyhovuje

**Stav:** přijato (2026-11-04)

## Kontext

Tři úrovně rizika (zelená, žlutá, červená) pocházejí z ČSN EN 15635 (Skladovací systémy
s ocelovými regály – Používání a údržba). Ostatní vybavení (žebříky podle ČSN EN 131, pevné
žebříky, OOPP…) takové stupně nemá, hodnotí se jako vyhovuje / nevyhovuje. Barvy u žebříků
působily matoucím dojmem. Uživatel rozhodl: barvy jen u regálů, jinde vyhovuje / nevyhovuje
a u závady volba, zda se fotky tisknou do protokolu (i z kanceláře).

## Rozhodnutí

- **Typ vybavení** má příznak `risk_levels` (_Hodnocení rizika podle ČSN EN 15635_). Knihovní
  typ „Regál“ ho má zapnutý, ostatní ne. Migrace 0011 ho zapne u existujících typů, jejichž
  název obsahuje „regál“ nebo mají pole `rack_type`.
- **Bez úrovní rizika** se „Nevyhovuje“ ukládá jako závada s nejvyšší úrovní (`severity = red`,
  vyřazení z provozu, vždy v protokolu). Server to vynutí podle typu artiklu, i když klient
  pošle jinou úroveň. Datový model výsledku se tím nemění; popisky (`outcomeLabel(…, riskLevels)`,
  `FIT_LABELS`) a protokol (skupina `unfit` „Nevyhovuje“) se řídí typem.
- **Fotky do protokolu:** výsledek má `photos_in_protocol` (výchozí ano). Technik ho nastaví
  u závady, kancelář přes `PUT /inspections/:id/results/:itemId/photos-in-protocol` (jen otevřená
  kontrola, audit). Vypnuté fotky se netisknou do protokolu, v exportech zůstávají.
- Výběr závad do protokolu (jen červené / červené + žluté / všechny) se týká úrovní regálů;
  nevyhovující vybavení je v protokolu vždy.

## Důsledky

- Starší výsledky žebříků se žlutou nebo zelenou úrovní se zobrazí jako „Nevyhovuje“ (podle
  typu), uložená úroveň zůstává v datech.
- Přepnutím příznaku u typu se změní jen zobrazení a nové zápisy, uložené výsledky se nepřepisují.

## Doplnění: závady nebránící bezpečnému provozu (2026-11-04)

- Typy bez úrovní rizika mají tři výsledky: **Vyhovuje**, **Závada – provoz možný** a
  **Nevyhovuje**. Formulace skupin v protokolu vychází z předpisů o revizích (vyhl. 85/1978 Sb.:
  „závady, které brání bezpečnému a spolehlivému provozu“) a z formuláře protokolu („schopno
  bezpečného provozu“): **Závady nebránící bezpečnému provozu** a **Závady bránící bezpečnému
  provozu**.
- Závada nebránící provozu se ukládá jako `severity = green` (bez vyřazení), nevyhovuje jako
  `red`. Server to vynutí podle typu (jiná úroveň → `red`) a obě jsou v protokolu vždy
  (`include_in_protocol`), fotky řídí `photos_in_protocol`.
- V protokolu skupina `minor` (ANO v tabulce) a `unfit` (NE); výběr „jen červené“ se jich
  netýká.
