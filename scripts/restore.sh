#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the running stack. REPLACES all current data.
# Usage: scripts/restore.sh <backup-dir> [--yes]
set -euo pipefail

DIR="${1:?Zadejte adresář zálohy, např. backups/revize-20261103-020000}"
DC=(docker compose)

[[ -f "$DIR/db.dump" && -f "$DIR/files.tar.gz" ]] || { echo "V $DIR chybí db.dump nebo files.tar.gz"; exit 1; }
(cd "$DIR" && sha256sum --quiet -c <(grep -E '^[0-9a-f]{64} ' manifest.txt)) || {
  echo "Kontrolní součty zálohy nesedí – soubor je poškozený."
  exit 1
}

if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "Obnovit zálohu $DIR? Všechna současná data budou nahrazena. Napište ANO: " answer
  [[ "$answer" == "ANO" ]] || { echo "Zrušeno."; exit 1; }
fi

echo "Zastavuji API…"
"${DC[@]}" stop api web

echo "Obnovuji databázi…"
"${DC[@]}" exec -T db dropdb -U revize --if-exists --force revize
"${DC[@]}" exec -T db createdb -U revize revize
"${DC[@]}" exec -T db pg_restore -U revize -d revize --no-owner --exit-on-error < "$DIR/db.dump"

echo "Obnovuji soubory…"
"${DC[@]}" run --rm --no-deps -T --entrypoint sh api \
  -c 'find /data/files -mindepth 1 -delete && tar -xzf - -C /data/files' < "$DIR/files.tar.gz"

echo "Spouštím API…"
"${DC[@]}" up -d --wait --wait-timeout 180 api web
echo "Obnova dokončena."
