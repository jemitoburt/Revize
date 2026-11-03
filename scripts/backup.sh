#!/usr/bin/env bash
# Backup of a running stack: database dump (pg_dump -Fc) and all files (photos) into
# <target>/revize-<timestamp>/, plus a manifest with checksums. Old backups are rotated.
# Usage: scripts/backup.sh [target-dir]      (run in the repository directory, e.g. from cron)
#   KEEP_DAYS=30   backups older than this many days are deleted (0 = keep all)
set -euo pipefail

TARGET="${1:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DIR="$TARGET/revize-$STAMP"
DC=(docker compose)

mkdir -p "$DIR.partial"
trap 'rm -rf "$DIR.partial"' ERR

echo "Záloha databáze…"
"${DC[@]}" exec -T db pg_dump -U revize -d revize -Fc > "$DIR.partial/db.dump"

echo "Záloha souborů (fotky)…"
"${DC[@]}" exec -T api tar -C /data/files -czf - . > "$DIR.partial/files.tar.gz"

FILES=$("${DC[@]}" exec -T api sh -c 'find /data/files -type f | wc -l' | tr -d '[:space:]')
{
  echo "created=$(date -Iseconds)"
  echo "files=$FILES"
  (cd "$DIR.partial" && sha256sum db.dump files.tar.gz)
} > "$DIR.partial/manifest.txt"

# Rename at the end: a backup directory without ".partial" is always complete.
mv "$DIR.partial" "$DIR"
trap - ERR
echo "Hotovo: $DIR ($(du -sh "$DIR" | cut -f1), souborů: $FILES)"

if [[ "$KEEP_DAYS" -gt 0 ]]; then
  find "$TARGET" -maxdepth 1 -type d -name 'revize-*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
fi
