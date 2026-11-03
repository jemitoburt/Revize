# Typy vybavení – knihovna podle norem

Výchozí typy pro administraci a ukázková data (`packages/shared/src/equipment-presets.ts`).
Pole, číselníky i texty protokolu lze po přidání libovolně upravit.

| Typ                   | Normy                                                                                                                                       | Interval | Klíčová pole                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Žebřík** (přenosný) | ČSN EN 131-1, -2, -3 (typy, požadavky, značení a návod), -4 (kloubové), -6 (teleskopické), -7 (pojízdné s plošinou), ČSN EN 14183 (schůdky) | 12 měs.  | výrobce, model, typ (opěrný, dvojitý, víceúčelový, výsuvný, kloubový, teleskopický, schůdky, pojízdný), označení (EN 131 Professional / Non-Professional / před r. 2018 / EN 14183), materiál, počet dílů a příček, délka, max. zatížení, stabilizátor, výrobní číslo, rok |
| **Pevný žebřík**      | ČSN 74 3282 (stavby), ČSN EN ISO 14122-4 (strojní zařízení)                                                                                 | 12 měs.  | účel, výška výstupu, materiál, ochrana proti pádu (koš / zachycovač / bez), odpočívadla, madla na výstupu, zabezpečení proti nepovolaným                                                                                                                                   |
| **Regál paletový**    | ČSN EN 15635, 15512, 15620, 15629                                                                                                           | 12 měs.  | výrobce, systém, uspořádání (jednostranný / oboustranný / double deep), rozměry, počet polí a úrovní, nosnost úrovně a pole, štítek nosnosti, kotvení, ochrana stojin                                                                                                      |
| **Regál policový**    | ČSN EN 15635, 15629                                                                                                                         | 12 měs.  | rozměry, počet polic, nosnost police a pole, štítek, kotvení                                                                                                                                                                                                               |
| **Regál konzolový**   | ČSN EN 15635, 15620                                                                                                                         | 12 měs.  | uspořádání, výška sloupu, délka ramene, počty sloupů a úrovní, nosnost ramene a sloupu                                                                                                                                                                                     |
| **Regál vjezdový**    | ČSN EN 15635, 15620                                                                                                                         | 12 měs.  | drive-in / drive-through, počty kanálů, úrovní a palet do hloubky, nosnost palety, vodicí lišty                                                                                                                                                                            |

Nabídka výrobců: žebříky Alve, Krause, Hailo, Zarges, Hymer, Günzburger Steigtechnik, Svelt,
Facal, Werner a Drabest. Regály Mecalux, Jungheinrich, Stow, Dexion, Kasten, Nedcon, META,
AR Racking, SSI Schäfer a Proma. Jiný výrobce jde vždy napsat ručně.

## Předvyplněná nosnost pole

Nosnost pole se u paletového regálu předvyplní jako **nosnost úrovně × počet úrovní** a u
policového jako **nosnost police × počet polic**.

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
  12 měsíců. Poškození se hodnotí semaforem: zelená v toleranci, žlutá/oranžová do dvojnásobku
  tolerance, červená nad ním. Měří se pravítkem 1 m na konkávní straně dílu. Poškozené díly se
  nahrazují, nerovnají.
- **EN 15620** stanoví tolerance, deformace a vůle (paletové, vjezdové a konzolové regály)
  a **EN 15512** návrh paletových regálů.

**Neověřeno:** zákonný interval pro kontroly žebříků v ČR. Rešerše nenašla konkrétní znění
předpisu. Interval 12 měsíců odpovídá běžné praxi a interním směrnicím. Ověřte prosím podle
předpisů, které používáte.

## Zdroje

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
