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
   - _Z knihovny podle norem:_ žebříky, pevné žebříky, regály paletové, policové, konzolové
     a vjezdové a typy z formuláře protokolu (sekční vrata, pojízdné lešení, OOPP, vozíky,
     rollkontejnery, ostatní vybavení), viz [typy-vybaveni.md](typy-vybaveni.md).
   - _Prázdný typ:_ vlastní pole.
   - **Pole:** popisek (z něj vznikne klíč), druh, povinnost, jednotka, hodnoty číselníku
     a nabízené hodnoty. Uložené pole nejde smazat, jde jen archivovat, aby se neztratila data.
   - **Druh pole** jde změnit i u uloženého pole a u typů z knihovny (např. text → číslo). Před
     uložením se ukáže, kolik hodnot u artiklů se převede a které ne. Ty, které převést nejde,
     zůstanou jako text k opravě a původní hodnoty jsou v auditu.
   - **Text protokolu** se zástupnými údaji (Zákazník, Datum kontroly…) a náhled.
5. **Artikly:**
   - Filtrujte zákazníka a provozovnu, pak **Nový artikl**. Pole se nabídnou podle typu.
   - **Číslo TZ** má 4 nebo 5 číslic a v celé evidenci je jen jednou. Bez čísla se přidělí
     další volné. `04001` = `4001`.
   - **Označení** (např. Ž-01, u regálu A1-12) je nepovinné a v provozovně jen jednou. Velikost
     písmen, mezery a pomlčky se při porovnání nepočítají. Hledat jde podle obojího.
   - Kliknutím na řádek artikl upravíte. Změna stavu (vyřazen z provozu ↔ v provozu) vyžaduje
     důvod a zapíše se do auditu.
   - **Export evidence** (Excel nebo CSV): artikly podle zvoleného filtru (bez filtru celá
     evidence). Obsahuje zákazníka, provozovnu, číslo TZ, označení, umístění, všechna pole, stav,
     příští a poslední kontrolu s výsledkem a závadou. V Excelu je list se vším a list pro každý
     typ vybavení.
   - Hromadné akce na zaškrtnutých artiklech: přesun, stav, datum příští kontroly, vyřazení
     z evidence.
6. **Uživatelé:** technici (role Technik) a další administrátoři. Reset hesla a deaktivace
   uživatele okamžitě odhlásí ze všech zařízení. **Smazat uživatele** (v jeho úpravě, s
   potvrzením) účet zruší: nepřihlásí se a zmizí ze seznamu. Jeho jméno zůstane u provedených
   kontrol a v auditu a e-mail jde použít pro nový účet. Vlastní účet ani posledního
   administrátora smazat nejde.
7. **Import (XLSX/CSV):**
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
8. **Nastavení** (administrátor):
   - Název firmy, IČO, adresa, kontakty a oprávnění technika (tiskne se pod podpisem).
   - Logo (PNG/JPEG), datum vydání a verze formuláře (hlavička stránek), text v zápatí stránek
     a doplňující text na konec protokolu.
   - Text o rozsahu kontroly je u každého typu vybavení v **Typy vybavení → Text protokolu**.
     Používá zástupné údaje (Naše firma, Zákazník, Provozovna, Datum kontroly…).
9. **Kontroly:**
   - Přehled otevřených a uzavřených kontrol s postupem a počtem závad. Řádek otevře detail
     s výsledky všech artiklů (filtry Závady a Nezkontrolované).
   - **Protokol:** náhled přesně v podobě tisku, **Tisk** a **Stáhnout**: PDF (A4), PDF se
     dvěma stranami na list (A4 na šířku) a Word (DOCX, dá se dál upravovat). Dokud kontrola
     není uzavřená, je protokol označený jako předběžný.
   - **Seznam vybavení pro zákazníka:** v náhledu protokolu zapněte _Přiložit seznam vybavení_
     a vyberte sloupce (číslo TZ, označení, typ, umístění, pole typu, výsledek, závada, příští
     kontrola). Seznam se přidá jako příloha na konec protokolu, v PDF i ve Wordu. Výběr
     sloupců si prohlížeč pamatuje. Fotky z iPadu se v protokolu objeví,
     až se odešlou (stav „Vše odesláno“).
   - **Uzavřít kontrolu:** výsledky se uzamknou a zkontrolované artikly dostanou datum příští
     kontroly. Je to buď zadané datum, nebo datum kontroly plus interval typu (obvykle 12 měsíců).
     Nezkontrolované artikly se v protokolu uvedou jako nezkontrolované.
   - **Znovu otevřít:** jen s uvedením důvodu, zapíše se do auditu.
   - **Export:**
     - _Výsledky – Excel_: list se souhrnem a list pro každý typ vybavení s jeho poli.
     - _Výsledky – CSV_: jedna tabulka, otevře se rovnou v českém Excelu.
     - _Fotky (ZIP s popisy)_: fotky závad pojmenované podle čísla artiklu (`10001_01.jpg`),
       fotky kontroly (`kontrola_01.jpg`) a seznam `fotky.csv`. Popis (artikl, umístění,
       závada, technik) je zapsaný přímo ve fotce (EXIF/IPTC), takže ho ukáže i prohlížeč fotek.
       V ukázce na GitHub Pages fotky popis nemají.
