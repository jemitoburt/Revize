# ADR-0007: Úložiště fotek za rozhraním `FileStorage`

**Stav:** přijato (2026-10-26)

## Rozhodnutí

- Rozhraní `FileStorage { put, read, delete, exists }` s klíči typu
  `photos/<yyyy>/<mm>/<photoId>/original.jpg` a `thumb.jpg`. Soubory se předávají jako bajty,
  protože fotky mají stovky kB. Stejné rozhraní tak implementuje i ukázka v prohlížeči
  (ADR-0015, tabulka v PGlite).
- Náhledy (delší strana 480 px, JPEG) dělá `ImageProcessor`: na serveru sharp, v ukázce canvas.
- Implementace `LocalDiskStorage` (volume `/data/files`). Cloud (S3-kompatibilní, například
  self-hosted MinIO/Garage) se dá přidat později jako další adaptér.
- Klient fotku před uploadem zmenší (delší strana 2048 px, JPEG asi 0,8). Server pomocí
  sharp otočí obrázek podle EXIF a vygeneruje náhled. Originál zůstává uložený.
- Do DB se ukládají metadata (sha256, rozměry, velikost); soubory v DB nejsou.

## Důsledky

- Záloha = `pg_dump` + kopie adresáře `/data/files` (viz M9).
