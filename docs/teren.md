# Terén – návod pro techniky (M5)

Terénní režim je na adrese `https://<server>/teren` a v ukázkové verzi na
`https://vitekdynka-debug.github.io/Revize/app/teren`. Technik (role Technik) se sem dostane
rovnou po přihlášení, administrátor přes menu **Kontroly v terénu**.

Na iPadu otevřete adresu v Safari a zvolte **Sdílet → Přidat na plochu**. Aplikace se pak spouští
přes celou obrazovku jako běžná aplikace.

## Zahájení kontroly

1. Klepněte na **Zahájit kontrolu**.
2. Vyberte zákazníka a provozovnu.
3. Případně vyberte typy vybavení (nic nevybráno = všechny typy).
4. Datum je dnešní. Klepněte na **Zahájit**.

Rozpracované kontroly jsou na úvodní stránce i s postupem. Ke stejné kontrole se může připojit víc
techniků současně. Stačí v ní zapsat první výsledek.

## Práce v kontrole

- **Seznam** je seřazený podle umístění (hala › řada › pozice) a čísla artiklu.
  - Filtry: _Nezkontrolované_ / _Závady_ / _Vše_, hala, typ a hledání (číslo TZ, označení,
    QR kód, výrobce…). Označení se hledá bez ohledu na velká písmena a pomlčky (`ž01` najde
    „Ž-01“).
  - Nahoře je počet zkontrolovaných a počty v pořádku, závad a vyřazených.
  - Klepnutím na řádek otevřete kartu artiklu. Po uložení výsledku se sama otevře další
    nezkontrolovaná položka seznamu.
- **Skenovat:** kamera zůstává zapnutá mezi artikly.
  - Načte se jen kód pod křížem a teprve po třech shodných přečteních, takže sousední štítky na
    archu nevadí.
  - Po zavření karty se pokračuje dalším kódem.
  - **Zavřít** skener ukončí. U podporovaných zařízení je k dispozici svítilna a zoom.
- **Číslo:**
  - Pětimístné číslo se otevře samo po páté číslici.
  - Čtyřmístné číslo zadejte s nulou na začátku (`04001`).
  - Jiné délky potvrďte **OK**.
  - **Označení** bez klávesnice: nad číslicemi jsou tlačítka s písmennými částmi označení
    artiklů v kontrole (např. **Ž**, **NH**, **AG**, **ŽLS**). Zadejte je v pořadí jako na
    štítku: **AG** + 01 najde AG01, 01 + **ŽLS** najde 01-ŽLS (pomlčky a mezery se nepočítají).
    Artikl se otevře sám, jakmile označení jednoznačně odpovídá; jinak potvrďte **OK**.
- **Bluetooth čtečka** v režimu klávesnice funguje kdykoli, když je otevřená kontrola. Najde
  artikl podle QR kódu, čísla TZ i označení.
- **Neznámý kód:** aplikace nabídne **Založit artikl s tímto kódem**. QR kód se předvyplní.
- **Nové umístění:** ve formuláři nového artiklu je pod polem Umístění tlačítko **Nové
  umístění**. Vyberete nadřazené umístění (např. Hala A) a napíšete název (např. Řada 9).
  Umístění se uloží do iPadu a odešle se před artiklem, takže funguje i bez signálu. Upravit nebo
  přesunout umístění jde jen v kanceláři.

Nový artikl jde v terénu uložit i bez povinných údajů (např. když chybí štítek s výrobcem);
kancelář ho pak najde přepínačem _Jen neúplné_ a doplní.

## Karta artiklu

- Ukazuje číslo, typ, umístění, QR kód, hodnoty polí a případný dřívější výsledek v této kontrole.
- **Regály** (typy se zapnutým hodnocením rizika podle ČSN EN 15635):
  - **V pořádku** uloží výsledek jedním klepnutím.
  - **Závada** má úroveň rizika. Napište popis, případně přidejte fotky závady a klepněte
    na **Uložit závadu**.
    - **Zelená:** poškození v mezích tolerance. Lze dále používat, poškození se zaznamená
      a sleduje při dalších kontrolách. V protokolu je „schopno bezpečného provozu: ANO“.
    - **Žlutá:** nebezpečné poškození. Poškozenou část vyprázdnit a do opravy nezaplňovat.
      Neopraví-li se do 4 týdnů, platí červené riziko. V protokolu je „NE“.
    - **Červená:** velmi vážné poškození. Okamžitě vyprázdnit a vyřadit z užívání až do opravy.
      Artikl se hned označí jako vyřazený. Vrátit ho do provozu může jen kancelář (s důvodem,
      zapíše se do auditu).
  - U zelené a žluté je zaškrtávátko **Zahrnout do protokolu** (výchozí zapnuté). Červená
    závada je v protokolu vždy.
- **Ostatní vybavení** (žebříky, pevné žebříky…):
  - **Vyhovuje** uloží výsledek jedním klepnutím.
  - **Závada – provoz možný:** závada nebránící bezpečnému provozu (např. chybí štítek,
    opotřebení). Vybavení zůstává v provozu, závada se zapíše do protokolu i s fotkami
    („schopno bezpečného provozu: ANO“).
  - **Nevyhovuje:** závada bránící bezpečnému provozu. Artikl se vyřadí z užívání až do opravy
    (jako červená u regálů), v protokolu je „NE“.
  - Obě závady jsou v protokolu vždy, každá ve své skupině. Popište závadu a klepněte na
    **Uložit závadu** / **Uložit – nevyhovuje**.
- U každé závady je zaškrtávátko **Zahrnout fotky do protokolu** (výchozí zapnuté). Vypnuté:
  fotky zůstanou u výsledku (export, kancelář), ale do protokolu se netisknou. Změnit to jde
  i v kanceláři.
- **Fotky artiklu** (výrobní štítek, celkový pohled) jdou přidat i u artiklu v pořádku. Když
  artikl ještě nemá výsledek nebo má závadu, aplikace se po klepnutí na **Vyfotit** zeptá, zda
  fotka patří **k závadě** (tiskne se do protokolu) nebo **k artiklu**. Zůstávají
  u artiklu i pro další kontroly.
- Hned po vyfocení se otevře **Upravit fotku**: tlačítky **Doleva** / **Doprava** fotku otočíte
  o 90°, tažením rohů ji oříznete (tažením uprostřed výřez posunete), **Celá** výřez zruší.
  **Uložit fotku** ji teprve uloží do zařízení, **Zahodit** ji zahodí. Úprava se provede
  na původní fotce, kvalita se tím nesnižuje.
- Fotku zobrazíte klepnutím na náhled. Tam ji jde i smazat.
- **Zrušit výsledek** vrátí artikl mezi nezkontrolované. Nejdřív je potřeba smazat fotky
  závady.

Když dva technici zapíšou tentýž artikl, platí výsledek zapsaný později. Ten přepsaný zůstane
v auditu.

## Fotky kontroly a ukončení

- **Fotky kontroly:** celkové fotky (hala, přístup, situace), které nepatří k žádnému artiklu.
- **Ukončit práci** ukáže souhrn a vrátí vás na úvodní stránku.
  - Výsledky se ukládají průběžně, takže nic dalšího ukládat nemusíte.
  - Kontrola zůstává otevřená. Uzavření, protokol a exporty dělá kancelář (M7).

## Práce bez signálu

- **Ukládání:** každý výsledek, fotka i nový artikl se nejdřív uloží do iPadu a teprve potom se
  ukáže jako uložený. Na server se odešle sám, jakmile je připojení. Zavřít aplikaci nebo vypnout
  iPad nevadí.
- **Stav v záhlaví:** _Vše odesláno_ / _Neodesláno: N_ / _Offline_ / _Vyžaduje pozornost_.
  Klepnutím zobrazíte seznam změn v zařízení. Jsou tam tlačítka **Odeslat nyní** a **Stáhnout
  neodeslaná data** (ZIP s daty a fotkami pro kancelář, kdyby se iPad už nikdy nepřipojil).
  Ikonka mráčku u artiklu v seznamu znamená, že jeho změny ještě čekají.
- **Před odjezdem** otevřete kontrolu, dokud máte signál. Seznam artiklů se uloží do iPadu.
- **Bez připojení nejde:** zahájit novou kontrolu, smazat fotku, která už je na serveru,
  a přihlásit se.
- **Odmítnutá změna** (např. číslo artiklu už mezitím založil někdo jiný) zůstane v seznamu jako
  _Vyžaduje pozornost_ s důvodem. Nic se nesmaže. Po vyřešení klepněte na **Zkusit znovu**.
- **Odhlášení:** pokud něco čeká na odeslání, aplikace se zeptá. Data zůstanou v iPadu a odešlou se
  po vašem dalším přihlášení.

## Ukázková verze

Na GitHub Pages jsou data jen v prohlížeči, ve kterém pracujete. Nezadávejte skutečná data
zákazníků. Obnovit ukázková data jde v uživatelském menu.
