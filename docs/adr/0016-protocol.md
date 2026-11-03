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

## Upřesnění 2026-11-03: Word, dvě strany na list, prázdné údaje

- **Chybějící údaje se vynechají.** Žádné náhradní texty typu „Bez umístění“ ani pomlčky.
- **Word (DOCX):** `GET /inspections/:id/protocol.docx` má stejný obsah a rozvržení jako PDF.
  Hlavička stránky s čísly stránek, tabulky, texty a fotky jsou skutečné prvky Wordu, takže jde
  dál upravovat. Vytváří ho knihovna `docx` (MIT) a funguje i v ukázce v prohlížeči.
- **Dvě strany na list:** `protocol.pdf?layout=two-up` vždy na A4 na šířku. Stránky A4 se
  zmenší vedle sebe (`pdf-lib`, MIT, stránky se vkládají vektorově). Při tisku z prohlížeče
  stejnou volbu nabízí tiskový dialog („Stránek na list: 2“).
- **Fotky** jsou v protokolu, až se odešlou z iPadu. Náhled protokolu upozorní, když na
  zařízení čekají neodeslané změny.

## Důsledky

- Změny rozvržení podle vzoru od uživatele jsou úprava jedné funkce a jejího testu. Data
  protokolu (`ProtocolData`) se nemění.
- Obraz API je o Chromium větší (zhruba +200 MB) a při generování PDF potřebuje zhruba 300 MB
  RAM navíc.
- Kdyby bylo potřeba víc šablon (jiné rozvržení pro různé zákazníky), přidá se volba šablony
  k typu vybavení nebo zákazníkovi.

## Doplnění 2026-11-03: rozvržení s co nejméně stranami

- `planProtocolLayout` (`packages/shared/src/protocol-layout.ts`) odhadne výšky z textu.
  Konstanty jsou změřené v PDF z Chromia: Arial 9 pt, 3,75 mm na řádek, 1,6 mm na znak, karta
  závady, nadpisy. Na tom rozhodnutí pracují HTML, PDF i Word stejně.
  - **Tabulka na 1. straně, nebo Příloha 1:** když se řádky nevejdou, je v protokolu jen odkaz
    a tabulka se vytiskne jako Příloha 1 (A4 na šířku, `@page appendix`, ve Wordu vlastní
    oddíl). Sloupce jsou přednastavené (`DEFAULT_APPENDIX_COLUMNS`), v náhledu jdou změnit.
    `?appendix=always` ji vynutí a `?part=appendix` vytiskne jen ji.
  - **Fotky a sloupce:** zkouší výšky fotek 60 až 35 mm a jeden nebo dva sloupce (dva jen
    při nejvýš jedné fotce na závadu). Vyhraje nejmenší počet stran, při shodě větší fotky
    a jeden sloupec. Rezerva 8 mm na stranu chrání před kartou přetékající na další stranu.
  - Varování s podpisy začíná na nové straně jen tehdy, když se nevejde pod tabulku. Závady
    pokračují za texty. Nadpis zůstává vždy s první kartou.
- Ověřeno na pěti modelových protokolech (A–E). Odhad „vejde se na 1. stranu“ se se
  skutečností shodoval ve 29 z 30 případů. Jediná chyba byla v bezpečném směru (příloha
  zbytečně, nikdy přetečení).

## Doplnění 2026-11-03: kompaktní protokol, závady podle závažnosti a pracoviště

- Protokol s desítkami závad musí zůstat krátký (přání uživatele). Proto jsou menší odsazení
  a řádky tabulek (7 mm), texty pokynů mají 8 pt a podpisová pole 13 mm.
- Závady se seskupují podle úrovně rizika (červená, žlutá, zelená) a pak podle pracoviště, tedy
  nejvyšší úrovně umístění (hala). Význam úrovně je napsaný jednou v nadpisu skupiny. Karta
  (8 pt) obsahuje číslo TZ, označení, zbytek umístění, popis a fotky. Karty jsou v jednom až
  třech sloupcích a řádky karet se nedělí mezi strany.
- Měřeno na PDF: 60 artiklů a 40 závad s jednou fotkou dá 7 stran (4 strany závad, 3 sloupce,
  fotky 3,5 cm). Se dvěma fotkami u závady 10 stran. Bez závad 2 strany.

## Doplnění 2026-11-03: cíl 8 stran, fotky 5 cm a 300 dpi, novinové sloupce

- **Výběr velikosti:** dokud odhad celého protokolu (včetně Přílohy 1) nepřesáhne 8 stran
  (`TARGET_PAGES`, cíl, ne strop), vyhrává výška fotek nejbližší 5 cm. Jinak vyhrává nejmenší
  počet stran a nejmenší rozměry, nejméně ale 3,5 cm.
- **Fotky** se do protokolu vkládají z originálů, oříznuté na tištěnou velikost v 300 dpi
  (`ImageProcessor.fit`, sharp, v ukázce canvas). Poměr stran je mezi 4:3 a 1:1, aby se dvě
  fotky vešly vedle sebe (`photoBox`).
- **Novinové sloupce:** karty tečou v CSS multicol (ve Wordu oddíl se sloupci), takže skupiny
  s pár závadami nenechávají poloprázdné řádky. Nadpis úrovně rizika jde přes celou šířku
  a nadpis haly drží s první kartou.
- **Výběr závad:** `?defects=red|red-amber|all` určuje, které úrovně dostanou kartu s fotkami.
- **Ověření:** deset modelových protokolů přes API (`test/protocol-samples.test.ts`, spouští
  se s `PROTOCOL_SAMPLES=<složka>`):

| Protokol | Artikly | Závady | Fotky | Stran | Fotky | Sloupce |
| -------- | ------- | ------ | ----- | ----- | ----- | ------- |
| 01       | 10      | 2      | 2     | 2     | 50 mm | 1       |
| 02       | 20      | 5      | 5     | 3     | 50 mm | 2       |
| 03       | 30      | 10     | 15    | 4     | 50 mm | 3       |
| 04       | 40      | 15     | 15    | 5     | 50 mm | 3       |
| 05       | 60      | 25     | 35    | 7     | 45 mm | 3       |
| 06       | 80      | 35     | 70    | 8     | 35 mm | 2       |
| 07       | 100     | 45     | 92    | 11    | 35 mm | 2       |
| 08       | 120     | 60     | 60    | 10    | 35 mm | 3       |
| 09       | 50      | 20     | 0     | 4     | –     | –       |
| 10       | 150     | 80     | 80    | 12    | 35 mm | 3       |
