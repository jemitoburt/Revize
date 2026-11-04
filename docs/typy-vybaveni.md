# Typy vybavení – knihovna podle norem

Výchozí typy pro administraci a ukázková data (`packages/shared/src/equipment-presets.ts`).
Pole, číselníky i texty protokolu lze po přidání libovolně upravit.

Regály jsou od 2026-11-03 jeden typ „Regál“ a druh určuje pole **Typ regálu** (přání uživatele).
Pole, která se týkají jen některého druhu (rameno, palety do hloubky…), jsou nepovinná a mají
to v popisku. Dříve přidané typy „Regál paletový / policový / konzolový / vjezdový“ zůstávají,
jak jsou, a jde je archivovat.

| Typ                       | Normy                                                                                                                                                                     | Interval | Klíčová pole                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Žebřík** (přenosný)     | ČSN EN 131-1, -2, -3 (typy, požadavky, značení a návod), -4 (kloubové), -6 (teleskopické), -7 (pojízdné s plošinou), ČSN EN 14183 (schůdky)                               | 12 měs.  | výrobce, model, typ (opěrný, dvojitý, víceúčelový, výsuvný, kloubový, teleskopický, schůdky, pojízdný), označení (EN 131 Professional / Non-Professional / před r. 2018 / EN 14183), materiál, počet dílů a příček, délka, max. zatížení, stabilizátor, výrobní číslo, rok                                                       |
| **Pevný žebřík**          | ČSN 74 3282 (stavby), ČSN EN ISO 14122-4 (strojní zařízení)                                                                                                               | 12 měs.  | účel, výška výstupu, materiál, ochrana proti pádu (koš / zachycovač / bez), odpočívadla, madla na výstupu, zabezpečení proti nepovolaným                                                                                                                                                                                         |
| **Regál** (všechny druhy) | ČSN EN 15635, 15512, 15620, 15629, ČSN 26 9030                                                                                                                            | 12 měs.  | **typ regálu** (paletový, policový, konzolový, vjezdový, průjezdný, spádový, pojízdný, mezaninový), výrobce, systém, uspořádání, rozměry, počet polí a úrovní/polic, nosnost úrovně a pole, u konzolových délka ramene a nosnost sloupu, u vjezdových palety do hloubky a vodicí lišty, štítek nosnosti, kotvení, ochrana stojin |
| **Vázací prostředky**     | ČSN EN 1492-1 (ploché vázací pásy), 1492-2 (kruhové smyce), 1492-4 (lana z vláken), ČSN EN 818-4 (řetězové úvazky), ČSN EN 13414-1 (ocelová lana), ČSN EN 1677 (součásti) | 12 měs.  | výrobce, druh (plochý pás, kruhová smyce, textilní lano, řetězový úvazek, ocelové lano), nosnost WLL v t, barva podle nosnosti, užitná délka, šířka pásu, materiál (PES, PA, PP, ocel), počet větví, zakončení, štítek čitelný, výrobní číslo, rok                                                                               |

Nabídka výrobců: žebříky Alve, Krause, Hailo, Zarges, Hymer, Günzburger Steigtechnik, Svelt,
Facal, Werner a Drabest. Regály Mecalux, Jungheinrich, Stow, Dexion, Kasten, Nedcon, META,
AR Racking, SSI Schäfer a Proma. Vázací prostředky Dolezych, SpanSet, pewag, Forankra,
KRATOS SAFETY, Popruhy-Lemfeld, RUD, Gunnebo Industries, Yale, Carl Stahl a Certex. Jiný výrobce
jde vždy napsat ručně.

## Předvyplněná nosnost pole

Nosnost pole se u regálu předvyplní jako **nosnost úrovně (police) × počet úrovní (polic)**.

- Předvyplnění se uplatní ve formuláři artiklu, v importu i v API.
- Dokud hodnotu nikdo nepřepíše, mění se se zadanými údaji.
- Pokud štítek nosnosti uvádí nižší nosnost pole (omezení rámů podle ČSN EN 15635), stačí ji
  přepsat a hodnota zůstane.
- U typů vytvořených z knihovny dřív se předvyplnění doplnilo migrací `0005`.

## Co z norem vyplývá (rešerše 2026-10-26)

- **EN 131** od roku 2018 rozlišuje _Professional_ a _Non-Professional_. Minimální nosnost je
  150 kg a staré třídy (Class 1, 3) se ruší. EN 131-1 platí pro přenosné žebříky a schůdky
  spadají pod EN 14183. Aktuální znění je EN 131-1:2015+A2:2025.
- **ČSN EN ISO 14122-4:** od výšky pádu 3 m musí mít pevný žebřík ochranné zařízení proti pádu.
  Přednost má ochranný koš, alternativou je zachycovač pádu na pevném vedení.
- **ČSN EN 15635** upravuje používání a údržbu regálů a zavádí roli PRSES. Rozlišuje pravidelné
  vizuální kontroly (týdenní nebo podle posouzení rizik) a odbornou inspekci nejméně jednou za
  12 měsíců. Poškození se hodnotí semaforem: zelená v toleranci, žlutá do dvojnásobku
  tolerance, červená nad ním. Měří se pravítkem 1 m na konkávní straně dílu. Poškozené díly se
  nahrazují, nerovnají.
- **EN 15620** stanoví tolerance, deformace a vůle (paletové, vjezdové a konzolové regály)
  a **EN 15512** návrh paletových regálů.

**Neověřeno:** zákonný interval pro kontroly žebříků v ČR. Rešerše nenašla konkrétní znění
předpisu. Interval 12 měsíců odpovídá běžné praxi a interním směrnicím. Ověřte prosím podle
předpisů, které používáte.

## Vázací prostředky (rešerše 2026-11-04)

- Typ **Vázací prostředky** hodnotí výsledek jako Vyhovuje / Závada – provoz možný / Nevyhovuje
  (bez barev rizika, ty jsou jen u regálů). Text do protokolu je návrh ve stylu formuláře.
- **ČSN EN 1492-1** platí pro ploché vázací pásy z chemických vláken, **ČSN EN 1492-2** pro
  kruhové smyce (nosnost do 40 t). Aktuální znění jsou EN 1492-1:2000+A1:2008 a
  EN 1492-2:2000+A1:2008. Navazují EN 1492-4 (lana z vláken) a EN 1677 (součásti úvazků).
- **Barvy podle nosnosti** (přímý tah): fialová 1 t, zelená 2 t, žlutá 3 t, šedá 4 t, červená 5 t,
  hnědá 6 t, modrá 8 t, oranžová 10 t a více.
- **Výrobci:** Dolezych (DE, vlastní výroba v Evropě, pásy a smyce podle EN 1492-1 a -2),
  SpanSet (švédská skupina, výroba a prodej mj. v DE a AT), pewag (AT, smyce a pásy
  z polyesteru). Na českém trhu dále Forankra (kruhové smyce, prodej vazacivazaky.cz),
  KRATOS SAFETY (distributor Pavlínek) a Popruhy-Lemfeld (český výrobce smyček na zakázku).
  RUD, Gunnebo Industries, Yale, Carl Stahl a Certex jsou běžné značky vázacích prostředků,
  jejich textilní sortiment rešerše neověřovala.

**Neověřeno:** interval kontroly 12 měsíců a vyřazovací kritéria nejsou z textu norem (ten
rešerše neměla k dispozici). 12 měsíců je běžná praxe. Vyřazovací kritéria v textu protokolu
(nečitelný štítek, prořezy, tepelné a chemické poškození, obnažené jádro smyce…) odpovídají
obvyklým pokynům výrobců. Ověřte prosím podle ČSN EN 1492 a návodu výrobce.

## Zdroje

- Dolezych: [Textile lifting equipment](https://www.dolezych.de/en/products/textile-lifting-equipment/)
- pewag: [Lifting Solutions](https://www.pewag.com/?p=22858)
- SpanSet GmbH & Co. KG: [Globus Hebetechnik](https://www.globus-hebetechnik.de/SpanSet-GmbH-Co-KG_1)
- EVS: [EN 1492-1:2000+A1:2008](https://evs.ee/en/evs-en-1492-1-2000-a1-2008-consolidated), [EN 1492-2:2000+A1:2008](https://www.evs.ee/en/evs-en-1492-2-2000-a1-2008-consolidated)
- Vázací vázaky: [Kruhové smyčky (Forankra)](https://vazacivazaky.cz/kategoria/nekonecne-kruhove-smycky)
- Pavlínek: [Vázací popruhy KRATOS](https://www.pavlinek.cz/products/vazaci-popruhy-kratos)
- Popruhy-Lemfeld: [Popruhové smyčky](https://www.popruhy-lemfeld.cz/popruhove-smycky/)
- Lana-řetězy: [Textilní vázací prostředky](https://www.lana-retezy.cz/textilni-vazaci-prostredky/)

- TÜV SÜD: [Bezpečnost žebříků](https://www.tuvsud.com/cs-cz/tisk-a-media/2025/september/bezpecnost-zebriku-neberte-na-lehkou-vahu)
- Werner: [EN131 Standards](https://www.wernerco.com/uk/latest-en131-standards)
- EVS: [EN 131-1:2015+A2:2025](https://www.evs.ee/en/evs-en-131-1-2015-a2-2025-consolidated)
- indupro: [Info EN 131](https://www.indupro.ch/media/wysiwyg/Schulung/info-en-131-en.pdf)
- Technický týdeník: [Přístup ke strojům a pevné žebříky](https://www.technickytydenik.cz/rubriky/archiv/pristup-ke-strojum-a-pevne-zebriky-pro-kominy_42410.html)
- TZB-info: [Bezpečnost regálových systémů ve skladech](https://www.tzb-info.cz/provoz-technologii/28631-bezpecnost-regalovych-systemu-ve-skladech-legislativa-kontroly-a-rizika-poskozeni)
- Dashöfer: [Regály – instalace, údržba, kontroly](https://www.dashofer.cz/download/seminare/BOZP-Regaly-ukazka_web.pdf)
- EVS: [EN 15620:2021](https://evs.ee/et/evs-en-15620-2021)
- Warehouse News / SEMA: [Inspection guidance](https://warehousenews.co.uk/2014/07/is-this-your-problem-storage-equipment-manufacturers-association-18/)
- MFF UK: [Interní směrnice ke kontrolám regálů a žebříků](https://www.mff.cuni.cz/vnitro/dekan/../tajemnik/pk1001.pdf)
