# ADR-0020: Artikl bez čísla TZ

**Stav:** přijato (2026-11-11)

## Kontext

Regály číslo TZ vůbec nemají, poznají se podle označení (NH01, AG01). U jiných artiklů číslo
v původní evidenci chybí a doplní se až na provozovně. Dosud import i formulář takovému
artiklu přidělily další volné číslo. To ale nesedí se štítky z tiskárny a později se může
srazit se skutečným číslem jiného artiklu. V původních evidencích je navíc často v jednom
sloupci u některých řádků číslo TZ a u jiných označení.

## Rozhodnutí

- `item.item_number` je nepovinné (null = bez čísla TZ). Unikátnost čísla v organizaci platí
  dál, artiklů bez čísla může být libovolně.
- Formulář artiklu (kancelář i terén): prázdné číslo = bez čísla TZ. API: vynechané
  `itemNumber` při založení = další volné číslo (zpětná kompatibilita), `null` nebo prázdné
  = bez čísla; úprava s `null` číslo odebere.
- Zobrazení: kde chybí číslo, zobrazí se označení (`itemLabel`). V protokolu je v prvním sloupci
  místo „TZ: …“ označení. Fotky v ZIP se jmenují podle označení (`NH01_01.jpg`).
- Import: přepínač „přidělit další volné číslo“ je ve výchozím stavu vypnutý, řádky bez čísla
  se naimportují bez čísla. Hodnota ve sloupci Číslo TZ, která není číslo TZ, se převezme
  jako označení (je-li v řádku prázdné), jinak se artikl naimportuje bez čísla s varováním.
  Číslo TZ a Označení mohou mít stejný sloupec: platné číslo TZ jde do čísla, ostatní do
  označení. Náhrady hodnot („Hodnoty…“) fungují i pro Číslo TZ a Označení.
- Aktualizace importem najde artikl bez čísla podle označení v provozovně a doplní mu číslo
  z řádku.
- Terén: naskenované neznámé číslo TZ jde přiřadit artiklu bez čísla (přednostně tomu, jehož
  karta byla otevřená naposledy). Kancelář: filtr _Jen bez čísla TZ_ (i v Exportu evidence).

## Důsledky

- Typ `itemNumber` je v API `string | null`; řazení podle čísla dává artikly bez čísla na konec.
- Úprava artiklu z terénu přes frontu posílá jen změněné údaje bez verze (pozdější vyhrává).
