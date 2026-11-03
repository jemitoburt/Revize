# ADR-0006: Dynamická pole typů vybavení (JSONB + Zod)

**Stav:** přijato (2026-10-26)

## Kontext

Nové typy vybavení musí jít přidat z administrace bez změny kódu.

## Rozhodnutí

- `equipment_type.field_definitions` (JSONB): pole `{key, label, kind, required, options, order,
unit, archived}`, kde kind je `text | number | integer | date | boolean | select | multiselect`.
- `item.field_values` (JSONB) se validuje schématem, které z definice sestaví `packages/shared`.
  Totéž schéma používá formulář, API i import.
- `key` pole je po vytvoření neměnný. Odebrané pole se jen archivuje, takže data zůstávají.
  `schema_version` se při změně definice zvýší.
- Filtrování podle vlastních polí přes JSONB operátory a GIN index.

## Důsledky

- Silná typová kontrola vlastních polí je jen za běhu, ne při kompilaci. Pro tento účel je to přijatelné.

## Změna 2026-11-03: druh uloženého pole jde změnit

Na přání uživatele (i u typů z knihovny). Při uložení se hodnoty všech artiklů typu převedou
stejně jako buňky importu (`convertItemValues`, tolerantně). Hodnota, která se nevejde, zůstane
jako text, takže se nic neztratí. U každého artiklu se zapíše audit
`item.field_kind_conversion` s původní hodnotou. Kancelář nejdřív uvidí náhled převodu
(`POST /equipment-types/:id/conversion-preview`). Nové hodnoty číselníku se přidají do pole.
