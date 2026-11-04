# ADR-0019: Interval kontrol u artiklu, umístění a provozovny

**Stav:** přijato (2026-11-04)

## Kontext

Interval kontrol (výchozí 12 měsíců) byl jen u typu vybavení. Na některých provozovnách nebo
halách (např. vysoký provoz vozíků) se kontroluje častěji, u jednotlivých artiklů jinak.

## Rozhodnutí

- Interval v měsících (1–120) jde nastavit u **provozovny**, u **umístění** (hala, řada…) a
  u **artiklu** (`inspection_interval_months`, prázdné = zděděné).
- Platí nejbližší: **artikl → nejbližší umístění (směrem nahoru) → provozovna → typ vybavení**
  (`inspectionIntervalOf` v `packages/shared`, na serveru `effectiveIntervals`).
- Uzavření kontroly bez společného data dá každému zkontrolovanému artiklu příští kontrolu
  podle jeho intervalu; vyplněné společné datum platí pro všechny. Dialog uzavření už datum
  nepředvyplňuje (přepsalo by intervaly), jen ukáže nejbližší.
- Otevřená kontrola ukazuje „Příští kontrola“ jako nejbližší datum podle intervalů artiklů.

## Důsledky

- Seznam artiklů kontroly (`GET /inspections/:id/items`) nese `intervalMonths` (platný interval).
- Změna intervalu se projeví až při dalším uzavření kontroly; uložená data příští kontroly se
  zpětně nepřepočítávají.
