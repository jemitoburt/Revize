# Kancelář – návod k evidenci (M3, M4, M7)

Přihlášení na `https://<server>/` (účet administrátora z `.env`).

1. **Zákazníci → Nový zákazník:** název, IČO, adresa, kontakt.
2. **Detail zákazníka → Nová provozovna.**
3. **Provozovna → Umístění:**
   - _Hlavní umístění_ (např. Hala A), pod ním **＋** (např. Řada 1).
   - Pro pozice zvolte v menu **⋯ → Přidat řadu podřízených** („Pozice“ od 1 do 20).
   - Šipky mění pořadí, **⋯ → Přesunout** přesune umístění i s podřízenými a artikly.
   - Archivovat jde jen umístění, ve kterém nejsou artikly.
4. **Typy vybavení → Nový typ:**
   - _Z knihovny podle norem:_ žebříky, pevné žebříky, vázací prostředky (textilní pásy,
     kruhové smyce, lana, řetězové úvazky), ocelové konstrukce, regál (paletový, policový, konzolový, vjezdový…) a typy z formuláře protokolu (sekční vrata, pojízdné lešení, OOPP, vozíky,
     rollkontejnery, ostatní vybavení), viz [typy-vybaveni.md](typy-vybaveni.md).
   - _Prázdný typ:_ vlastní pole.
   - **Sloučit typy…** (např. dřívější „Regál paletový / policový / konzolový / vjezdový“ do jednoho
     „Regál“): zvolíte **cílový typ** – jeho nastavení zůstane (pole, interval, text protokolu,
     hodnocení rizika) – a typy, které se do něj sloučí. Cílový typ dostane pole, která neměl,
     artikly přejdou do něj a původní druh se jim zapíše do pole („Typ regálu“ = „Paletový“ …).
     Sloučené typy se archivují. Před sloučením se ukáže náhled. Sloučení je v auditu.
   - **Pole:** popisek (z něj vznikne klíč), druh, povinnost, jednotka, hodnoty číselníku
     a nabízené hodnoty. Uložené pole nejde smazat, jde jen archivovat, aby se neztratila data.
   - **Druh pole** jde změnit i u uloženého pole a u typů z knihovny (např. text → číslo). Před
     uložením se ukáže, kolik hodnot u artiklů se převede a které ne. Ty, které převést nejde,
     zůstanou jako text k opravě a původní hodnoty jsou v auditu.
   - **Text protokolu** se zástupnými údaji (Zákazník, Datum kontroly…) a náhled.
   - **Hodnocení rizika podle ČSN EN 15635** (zelená / žlutá / červená) je zapnuté jen u regálů.
     U ostatních typů technik hodnotí **Vyhovuje / Závada – provoz možný / Nevyhovuje**. V protokolu
     jsou závady ve skupinách „Závady nebránící bezpečnému provozu“ (ANO, zůstává v provozu)
     a „Závady bránící bezpečnému provozu“ (NE, vyřazeno z provozu), vždy i s fotkami.
5. **Artikly:**
   - Filtrujte zákazníka a provozovnu, pak **Nový artikl**. Pole se nabídnou podle typu.
   - **Číslo TZ** má 4 nebo 5 číslic a v celé evidenci je jen jednou. Bez čísla se přidělí
     další volné. `04001` = `4001`.
   - **Označení** (např. Ž-01, u regálu A1-12) je nepovinné a v provozovně jen jednou. Velikost
     písmen, mezery a pomlčky se při porovnání nepočítají. Hledat jde podle obojího.
   - Kliknutím na řádek artikl upravíte. Změna stavu (vyřazen z provozu ↔ v provozu) vyžaduje
     důvod a zapíše se do auditu.
   - **Filtry podle kontrol:** _Příští kontrola_ (po termínu, do 30 / 60 / 90 dní) a _Poslední
     kontrola → Nezkontrolované v poslední kontrole_ (artikl existoval při poslední uzavřené
     kontrole své provozovny, která zahrnovala jeho typ, ale nemá v ní výsledek). Filtry platí
     i pro Export evidence.
   - **Historie kontrol** v detailu artiklu (i v detailu kontroly): každá kontrola provozovny,
     která artikl zahrnovala, s výsledkem, závadou, kdo zapsal a počtem fotek, nebo
     „Nezkontrolován“. Datum otevře kontrolu.
   - **Export evidence**: artikly podle zvoleného filtru (bez filtru celá databáze, včetně
     artiklů vyřazených z evidence).
     - Excel: list _Vše_ a list pro každý typ vybavení – zákazník, provozovna, číslo TZ,
       označení, typ, umístění, **V provozu (ANO/NE)**, všechna pole, příští a poslední kontrola,
       výsledek, **schopno bezpečného provozu (ANO/NE)** a poznámka jako v Příloze 1. List
       **Historie kontrol** má každý výsledek každé kontroly (datum, stav kontroly, výsledek,
       vyřazení, poznámka, zahrnutí do protokolu, kdo a kdy zapsal, počet fotek závady).
     - CSV: evidence a zvlášť historie kontrol.
   - Stažené soubory mají v názvu čas (`…_1012.xlsx`), takže se nikdy nesplete starší soubor
     se stejným názvem ve Stažených souborech.
   - Hromadné akce na zaškrtnutých artiklech: přesun, stav, datum příští kontroly, vyřazení
     z evidence.
6. **Historie změn** (administrátor, oprávnění `audit.read`): kdo, kdy a co změnil – artikly,
   výsledky kontrol, fotky (i smazané a přesunuté), typy vybavení, zákazníci, uživatelé
   i přihlášení. Filtry podle oblasti, uživatele a data, u změn je vidět původní a nová hodnota.
   Záznamy nejdou upravit ani smazat. Starší záznamy načte tlačítko _Načíst starší_.
7. **Uživatelé:** technici (role Technik) a další administrátoři. Reset hesla a deaktivace
   uživatele okamžitě odhlásí ze všech zařízení. **Smazat uživatele** (v jeho úpravě, s
   potvrzením) účet zruší: nepřihlásí se a zmizí ze seznamu. Jeho jméno zůstane u provedených
   kontrol a v auditu a e-mail jde použít pro nový účet. Vlastní účet ani posledního
   administrátora smazat nejde.
8. **Import (XLSX/CSV):**
   - Zvolte zákazníka, provozovnu a typ vybavení. **Stáhnout šablonu** dá XLSX se správnými
     sloupci, číselníky jako rozbalovací seznam a listem _Nápověda_.
   - Nahrajte soubor (XLSX nebo CSV do 10 MB a 20 000 řádků). CSV může být v UTF-8 i ve
     Windows-1250 a oddělovač (`;`, `,`, tabulátor) se pozná sám. Starý formát `.xls` uložte
     v Excelu jako `.xlsx`.
   - **Mapování:** ke každému poli vyberte sloupec, vedle uvidíte ukázku hodnot. Systém navrhne
     sloupce podle záhlaví a pro daný typ si pamatuje poslední použité mapování. Umístění může
     být ve více sloupcích (Hala, Řada, Pozice) nebo v jednom s oddělovačem (`Hala A / Řada 1`).
   - **Hodnoty…** u každého pole (platí jen pro to jedno pole, ne pro celý soubor):
     - _Hodnota pro všechny artikly_ se použije, když pole v souboru nemá sloupec, nebo když je
       buňka prázdná (např. nosnost „150 kg“). Při aktualizaci nepřepíše vyplněnou hodnotu
       artiklu.
     - _Nahradit hodnoty ve sloupci_ ukáže všechny hodnoty sloupce s počtem řádků. Ke každé
       můžete zadat náhradu (např. „Kolo“ → „Opěrný“) a ta platí pro všechny řádky. Velikost
       písmen ani diakritika nehrají roli.
     - Náhrady i hodnoty si systém zapamatuje s mapováním typu pro příští soubor.
   - **Režim:** _Jen nové artikly_ (existující číslo je chyba), nebo _Nové i aktualizovat
     existující_. Při aktualizaci prázdná buňka hodnotu artiklu nemaže.
   - **Kontrola:** ukáže, co se založí, aktualizuje a které řádky mají chybu a proč. Do databáze
     se zatím nic nezapsalo.
     - _Varování_ (hodnota převzatá jako text, nová hodnota číselníku, chybějící povinný údaj)
       import nezastaví. Takové hodnoty doplníte nebo opravíte u artiklu.
     - **Seznam problémů:** každá nevyhovující hodnota pole je tu jednou i s počtem řádků.
       _Nahradit_ ji změní za jinou hodnotu ve všech řádcích toho pole. _Přijmout_ ji
       naimportuje tak, jak je. _Přeskočit_ ji nenaimportuje a pole zůstane prázdné. Po náhradě
       nebo přeskočení se kontrola spustí znovu a náhrady se zapamatují s mapováním.
     - _Chyby_ (neplatné nebo duplicitní číslo, obsazený QR kód) opravte v souboru, nebo
       zaškrtněte _Přeskočit řádky s chybami_.
   - **Importovat:** proběhne najednou v jedné transakci, takže buď vše, nebo nic. Chybějící
     umístění se založí, artikly bez čísla dostanou další volná čísla. Každý artikl má záznam
     v auditu.
9. **Nastavení** (administrátor):
   - Název firmy, IČO, adresa a kontakty.
   - **Datum vydání** a **Verze** v hlavičce stránek: prázdné = datum uzavření kontroly
     (u předběžného protokolu dnešní) a verze 1, po každém znovuotevření o 1 víc. Vyplněné
     hodnoty platí pro všechny protokoly.
   - **Oprávnění technika** má každý uživatel ve svém profilu (**Můj účet → Profil technika**,
     administrátor i v Uživatelé): **obecné** a **pro každý typ vybavení** zvlášť (vázací
     prostředky, regály…). Pod podpisem se tiskne oprávnění vedoucího technika pro typy
     v protokolu: u jednoho typu jen jeho oprávnění, u více typů po řádcích „Typ: oprávnění“;
     typy bez vlastního oprávnění použijí obecné.
   - Logo (PNG/JPEG), datum vydání a verze formuláře (hlavička stránek), text v zápatí stránek
     a doplňující text na konec protokolu.
   - Text o rozsahu kontroly je u každého typu vybavení v **Typy vybavení → Text protokolu**.
     Používá zástupné údaje (Naše firma, Zákazník, Provozovna, Datum kontroly…).
10. **Kontroly:**
    - Přehled otevřených a uzavřených kontrol s postupem a počtem závad. Řádek otevře detail
      s výsledky všech artiklů (filtry Závady a Nezkontrolované).
    - **Klepnutím na řádek** se otevře artikl: jde opravit výsledek (výsledek, popis závady,
      zahrnutí do protokolu), prohlížet, přidávat a mazat fotky a přesouvat je mezi _Fotky
      závady_ (tisknou se do protokolu) a _Fotky artiklu_ (štítek, celkový pohled – netisknou
      se), a upravit artikl (označení, pole, umístění). Výsledek a fotky jdou měnit jen
      u otevřené kontroly, oprava se zapíše jako nový výsledek a do auditu.
    - **Příští kontrola** se u otevřené kontroly ukazuje podle intervalů (datum kontroly + interval).
      Při uzavření dostane každý artikl příští kontrolu podle svého intervalu: **artikl → hala
      (umístění) → provozovna → typ vybavení** (výchozí 12 měsíců). Interval se nastavuje u artiklu
      (Interval kontrol), u umístění (menu umístění → Upravit) a u provozovny. Vyplněné datum
      v dialogu uzavření platí pro všechny artikly.
    - **Uzavření kontroly** smaže ze serveru fotky závad z předchozích kontrol stejných artiklů
      (nahradí je fotky nové kontroly). Dialog ukáže, kolik jich bude, a připomene zálohu přes
      Export → Fotky (ZIP) u předchozí kontroly. Vypnout to jde v Nastavení.
    - Ve sloupci **Fotky** je u závady s fotkami zaškrtávátko **do protokolu**: vypnuté fotky se
      do protokolu netisknou (zůstávají v exportu). Jde měnit, dokud je kontrola otevřená;
      změna se zapíše do auditu.
    - **Kontrola více typů najednou:** v terénu se při zahájení zvolí více typů vybavení (nebo
      žádný = všechny). V kanceláři v náhledu protokolu **Typy vybavení v protokolu**: prázdné =
      všechny typy v jednom protokolu s texty všech kategorií, nebo libovolná kombinace, nebo
      jeden typ (soubor má typ v názvu). **Stáhnout → PDF – každý typ zvlášť (ZIP)** vytvoří
      zvláštní protokol pro každý typ najednou.
    - **Protokol:** náhled přesně v podobě tisku, **Tisk** a **Stáhnout**: PDF (A4), PDF se
      dvěma stranami na list (A4 na šířku; Příloha 1 na šířku dostane celý list sama) a Word (DOCX, dá se dál upravovat). Dokud kontrola
      není uzavřená, je protokol označený jako předběžný.
    - **Rozvržení protokolu** se volí samo, aby měl protokol co nejméně stran:
      - Když se tabulka vybavení vejde na první stranu, je v protokolu. Když ne, protokol na ni
        jen odkáže („Kontrolované vybavení viz Příloha 1 – tabulka kontrolovaného vybavení“)
        a vytiskne ji na konci na A4 na šířku se zvolenými sloupci (číslo TZ, označení, typ,
        umístění, schopno bezpečného provozu, poznámka…). Nezpůsobilé vybavení je tučně
        a červeně. Přepínač _Tabulku vybavení vždy jako Přílohu 1_ ji tam dá vždy.
      - Závady jsou seskupené podle závažnosti (červené, bránící bezpečnému provozu, žluté, zelené, nebránící bezpečnému provozu – co znamenají,
        je napsáno jednou u skupiny) a pak podle pracoviště (hala). Karty jsou kompaktní: číslo TZ,
        označení, řada a pozice, popis a fotky, v jednom až třech sloupcích.
      - Přepínač **Co nejkratší protokol** (zapamatuje se) vždy zvolí nejmenší fotky (3,5 cm)
        a víc sloupců závad, i když by se protokol vešel do 8 stran.
      - Volba _Všechny / Červené a žluté / Jen červené_ je vidět jen u kontrol s regály.
      - Fotky mají kolem 5 cm na výšku (nejlépe se čtou), dokud má protokol nejvýš 8 stran.
        U delších protokolů se volí nejmenší rozměry, nikdy ale pod 3,5 cm. Fotky se vkládají
        v rozlišení 300 dpi přesně podle tištěné velikosti, mírně oříznuté (až na čtverec), aby
        se dvě vešly vedle sebe.
      - Karty závad tečou v novinových sloupcích (1–3), takže malé skupiny nenechávají prázdná
        místa.
      - Volba **Všechny závady / Červené a žluté / Jen červené** určuje, které závady dostanou
        v protokolu kartu s fotkami. Tabulka vybavení dál uvádí výsledky všech artiklů.
      - Varování a podpisy se vejdou-li, pokračují na první straně a závady na straně s texty.
      - **Stáhnout → Jen příloha 1** vytiskne tabulku samostatně (PDF nebo Word).
      - Výběr sloupců si prohlížeč pamatuje. Fotky z iPadu se v protokolu objeví,
        až se odešlou (stav „Vše odesláno“).
    - **Uzavřít kontrolu:** výsledky se uzamknou a zkontrolované artikly dostanou datum příští
      kontroly. Je to buď zadané datum, nebo datum kontroly plus interval typu (obvykle 12 měsíců).
      Nezkontrolované artikly se v protokolu uvedou jako nezkontrolované.
    - **Znovu otevřít:** jen s uvedením důvodu, zapíše se do auditu.
    - **Export:**
      - _Výsledky – Excel_: list se souhrnem a list pro každý typ vybavení s jeho poli.
      - _Výsledky – CSV_: jedna tabulka, otevře se rovnou v českém Excelu.
      - _Fotky (ZIP s popisy)_: fotky závad pojmenované podle čísla artiklu (`10001_01.jpg`),
        fotky artiklů (`10001_artikl_01.jpg`),
        fotky kontroly (`kontrola_01.jpg`) a seznam `fotky.csv`. Popis (artikl, umístění,
        závada, technik) je zapsaný přímo ve fotce (EXIF/IPTC), takže ho ukáže i prohlížeč fotek.
        V ukázce na GitHub Pages fotky popis nemají.
