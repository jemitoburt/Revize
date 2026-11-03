# ADR-0017: Exporty kontroly – XLSX, CSV a ZIP fotek s metadaty

**Stav:** přijato (2026-11-03, M7 část 2)

## Kontext

Kancelář potřebuje výsledky kontroly dál zpracovat (Excel, vlastní systémy) a předat
zákazníkovi fotky závad tak, aby u každé bylo vidět, ke kterému artiklu patří, i když se
soubor oddělí od protokolu.

## Rozhodnutí

- **Endpointy** (oprávnění `inspection.read`): `GET /api/inspections/:id/export.xlsx`,
  `export.csv` a `photos.zip`. V kanceláři je tlačítko **Export** v detailu kontroly.
- **Tabulka** (`packages/shared/src/export.ts`, společná pro XLSX i CSV): kontrolní číslo, typ,
  umístění, QR kód, pole typu, výsledek, úroveň rizika, popis závady, vyřazení, zahrnutí do
  protokolu, kdo a kdy zapsal, názvy fotek, příští kontrola.
  - **XLSX:** list „Kontrola“ se souhrnem a jeden list na typ vybavení s jeho vlastními poli.
    Čísla zůstávají čísly, záhlaví je ukotvené a má filtr.
  - **CSV:** jedna tabulka se sjednocenými poli všech typů. Je pro český Excel: UTF-8 s BOM,
    středník, desetinná čárka, CRLF.
- **ZIP fotek:**
  - Fotky závad se jmenují `<číslo artiklu>_01.jpg` a fotky kontroly `kontrola_01.jpg`.
  - V ZIP je i `fotky.csv` se seznamem a popisy.
  - Do každé JPEG fotky se zapíše EXIF, IPTC (UTF-8) i XMP: název (číslo artiklu), popis
    (artikl, typ, umístění, úroveň rizika, závada), klíčová slova, autor (technik), copyright
    (firma), umístění a čas pořízení.
  - Exportují se originály. ZIP se posílá proudem po jedné fotce (fflate, bez komprese JPEG),
    takže v paměti je vždy jen jedna fotka.
- **Metadata** zapisuje `MetadataWriter`. Na serveru je to ExifTool přes exiftool-vendored
  (schválená výjimka licence, samostatný proces, obraz API má Perl). Ukázka v prohlížeči
  ExifTool nemá (`noMetadataWriter`), takže ZIP tam obsahuje fotky beze změny.
- Místo archiveru, který byl v původním plánu, se používá fflate (MIT). Ten už aplikace
  používá a funguje stejně na serveru i v prohlížeči.

## Důsledky

- Export celé evidence a filtrované exporty (M8) použijí stejné funkce tabulky.
- Obraz API je o Perl větší (zhruba 40 MB).
- Test obnovy v CI ověřuje ZIP fotek včetně popisu zapsaného ExifToolem ve skutečném obrazu.
