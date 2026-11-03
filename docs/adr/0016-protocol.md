# ADR-0016: PDF protokol – šablona v kódu, nastavení v kanceláři

**Stav:** přijato (2026-11-03), rozvržení se upraví podle vzoru od uživatele

## Kontext

Protokol o kontrole je hlavní výstup pro zákazníka. Uživatel zvolil variantu „podle vzoru +
nastavení“: rozvržení se připraví podle jeho vzoru a v kanceláři se nastavují údaje a texty.
Šablona ve Wordu (vyžadovala by LibreOffice) ani vizuální editor se nedělají.

## Rozhodnutí

- **Rozvržení** je jedna funkce `renderProtocolHtml(data)` ve `shared` (HTML + tiskové CSS, A4).
  Obsahuje:
  - hlavičku s logem a údaji firmy,
  - údaje o zákazníkovi, provozovně, datu, příští kontrole a technicích,
  - souhrn,
  - pro každý typ vybavení jeho text s doplněnými zástupnými údaji a tabulku artiklů,
  - závady s náhledy fotek, fotodokumentaci kontroly, podpisy a zápatí.
- **V kanceláři se nastavuje:**
  - **Nastavení:** firma, IČO, adresa, kontakty, oprávnění technika, logo, zápatí.
  - **Typy vybavení:** text protokolu u každého typu.
- **PDF** dělá server přes rozhraní `PdfRenderer`, implementace je headless Chromium přes
  playwright-core (v obrazu API Chromium a písma Noto z Alpine). Čísla stran („Strana X z Y“)
  a číslo protokolu jsou v zápatí. Obrázky jsou v HTML jako data URL, prohlížeč při tisku nic
  nestahuje.
- **Ukázka v prohlížeči** nemá PDF renderer (`pdf: null`, API vrací 501). Kancelář tam tiskne
  náhled z prohlížeče („Tisk / uložit jako PDF“), který vypadá stejně.
- **Předběžný protokol:** do uzavření kontroly nese výrazné označení. Po uzavření je konečný.
  Číslo protokolu je `<datum kontroly>/<posledních 8 znaků ID kontroly>`.

## Důsledky

- Změny rozvržení podle vzoru od uživatele jsou úprava jedné funkce a jejího testu. Data
  protokolu (`ProtocolData`) se nemění.
- Obraz API je o Chromium větší (zhruba +200 MB) a při generování PDF potřebuje zhruba 300 MB
  RAM navíc.
- Kdyby bylo potřeba víc šablon (jiné rozvržení pro různé zákazníky), přidá se volba šablony
  k typu vybavení nebo zákazníkovi.
