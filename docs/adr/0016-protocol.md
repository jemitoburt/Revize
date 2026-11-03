# ADR-0016: PDF protokol – šablona v kódu, nastavení v kanceláři

**Stav:** přijato (2026-11-03), rozvržení podle vzoru upřesněno týž den

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

## Upřesnění 2026-11-03 podle popisu uživatele

- **Text protokolu** je u každé sekce jen ten, který patří k jejímu typu vybavení. Protokol jde
  vytvořit i pro jediný typ (`?equipmentTypeId=`, výběr v náhledu).
- **Tabulka artiklů:** Číslo | Název a popis | Vyhovuje (zaškrtávací pole ano/ne) | Poznámka /
  závada. Je to skutečná tabulka s pevnými šířkami sloupců (`table-layout: fixed`). Řádek se
  nerozdělí mezi strany a záhlaví se na další straně opakuje.
- **Závady se zmenšenými fotkami** jsou až na dalších stranách. Nejdřív závažné (červené),
  potom ostatní (oranžové, zelené).

## Upřesnění 2026-11-03 podle vzoru (`docs/vzory/protokol-o-kontrole.pdf`)

Uživatel chce držet původní šablonu, bez vlastního „designu“ a barev navíc. Protokol proto
kopíruje formulář firmy:

- **Hlavička každé stránky:** logo, řádek „firma, adresa, IČ“, název formuláře, Datum vydání,
  Verze a „Stránka X z Y“. Datum vydání a verze formuláře se nastavují v Nastavení. V PDF je
  hlavička i zápatí šablonou Chromia (`protocolPageHeader`/`protocolPageFooter`, rozhraní
  `PdfRenderer` dostává hlavičku, zápatí a okraje). Při tisku z prohlížeče se vytisknou jen
  jednou a bez čísla stránky.
- **Zápatí:** vlevo text z Nastavení (např. „BOZP • PO • REVIZE“), vpravo web.
- **Údaje:** Provozovatel, Pracoviště/objekt/umístění, Kontrolu provedl, Kontrola provedena
  dne, Následnou kontrolu provést nejpozději do.
- **Tabulka** „Kontrolované technické vybavení – <typ>“: Kontrolní číslo | Popis | Schopno
  bezpečného provozu* ANO/NE | Poznámka (popis zjištění, závady, doporučení atd.). Podle
  poznámky „*nehodící se škrtněte“ se nehodící odpověď přeškrtne: v pořádku a zelená = ANO,
  žlutá a červená = NE, nezkontrolováno = nic. U závady je v poznámce popis a úroveň rizika.
- **Další strana:** „Při výsledku kontroly nevyhovuje musí být technické vybavení okamžitě
  vyřazeno z užívání“, podpisy (Kontrolu provedl, S výsledkem kontroly byl seznámen), dva
  standardní body formuláře a doplňující text z Nastavení.
- **Pokyny k provádění kontrol:** jen texty typů, které v protokolu jsou. Stejný text více typů
  (všechny regály) se vytiskne jednou. Texty jsou texty z formuláře. Formát: `# nadpis`,
  `• bod`, odsazený `• podbod` (`protocolTextHtml`).
- **Závady s fotkami** jsou na dalších stranách: nejdřív závažné (červené), pod nimi ostatní.
- Barvy jsou jen ty z formuláře: červené nadpisy a žluté pole s webem. Šedé jsou buňky
  s popisky.
- Knihovna typů obsahuje i typy, které formulář zná (sekční vrata, pojízdné lešení, OOPP,
  vozíky, rollkontejnery, ostatní vybavení), s jejich texty. Migrace `0008` nahradila staré
  návrhy textů u typů, kde zůstaly beze změny.

## Důsledky

- Změny rozvržení podle vzoru od uživatele jsou úprava jedné funkce a jejího testu. Data
  protokolu (`ProtocolData`) se nemění.
- Obraz API je o Chromium větší (zhruba +200 MB) a při generování PDF potřebuje zhruba 300 MB
  RAM navíc.
- Kdyby bylo potřeba víc šablon (jiné rozvržení pro různé zákazníky), přidá se volba šablony
  k typu vybavení nebo zákazníkovi.
