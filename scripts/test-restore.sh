#!/usr/bin/env bash
# Automatic restore test (CI and before upgrades): fills a running stack with data incl. a
# photo, backs it up, wipes everything, starts a clean stack, restores and compares.
# Usage: scripts/test-restore.sh <base-url> <admin-email> <admin-password>
# Needs SEED_DEMO=true in .env (demo customer and items). DESTROYS the stack's data.
set -euo pipefail

BASE="${1:-https://localhost}"
EMAIL="${2:-admin@revize.local}"
PASSWORD="${3:?admin password}"
CURL=(curl -sS -k --noproxy '*' --fail-with-body --retry 10 --retry-delay 3 --retry-all-errors)
DC=(docker compose)
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

token() {
  "${CURL[@]}" -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/login" | jq -r .token
}
api() { "${CURL[@]}" -H "authorization: Bearer $TOKEN" "$@"; }
snapshot() {
  {
    api "$BASE/api/items?limit=1000" | jq -c '[.items[] | {itemNumber, status, qrCode}] | sort_by(.itemNumber)'
    api "$BASE/api/inspections" | jq -c '[.[] | {id, progress}]'
    api "$BASE/api/photos?inspectionId=$INSPECTION" | jq -c '[.[] | {id, sizeBytes}]'
    api "$BASE/api/photos/$PHOTO/original" | sha256sum
  } > "$1"
}

TOKEN="$(token)"
SITE=$(api "$BASE/api/customers" | jq -r '.[0].id' | xargs -I{} "${CURL[@]}" -H "authorization: Bearer $TOKEN" "$BASE/api/customers/{}/sites" | jq -r '.[0].id')
INSPECTION="0190e8a0-0000-7000-8000-0000000b0001"
PHOTO="0190e8a0-0000-7000-8000-0000000b0002"
api -X PUT -H 'content-type: application/json' \
  -d "{\"siteId\":\"$SITE\",\"inspectionDate\":\"$(date +%F)\"}" "$BASE/api/inspections/$INSPECTION" > /dev/null
ITEM=$(api "$BASE/api/inspections/$INSPECTION/items" | jq -r '.[0].id')
api -X PUT -H 'content-type: application/json' \
  -d "{\"id\":\"0190e8a0-0000-7000-8000-0000000b0003\",\"outcome\":\"defect\",\"defectDescription\":\"Test obnovy\",\"recordedAt\":\"$(date -u +%FT%TZ)\"}" \
  "$BASE/api/inspections/$INSPECTION/results/$ITEM" > /dev/null
# A real JPEG goes through the API's image processing (sharp) into the files volume.
"${DC[@]}" exec -T api node -e "require('sharp')({create:{width:800,height:600,channels:3,background:'#c00'}}).jpeg().toBuffer().then(b=>process.stdout.write(b))" > "$WORK/photo.jpg"
api -X PUT -F owner=inspection -F "inspectionId=$INSPECTION" -F "file=@$WORK/photo.jpg;type=image/jpeg" \
  "$BASE/api/photos/$PHOTO" > /dev/null
snapshot "$WORK/before.txt"

KEEP_DAYS=0 scripts/backup.sh "$WORK/backups"
BACKUP=$(ls -d "$WORK"/backups/revize-* | head -1)

echo "Mažu všechna data a spouštím čistou instanci…"
"${DC[@]}" down -v
"${DC[@]}" up -d --wait --wait-timeout 180
scripts/restore.sh "$BACKUP" --yes

TOKEN="$(token)"
snapshot "$WORK/after.txt"
# The PDF protocol of the restored inspection (Chromium and fonts in the API image).
api "$BASE/api/inspections/$INSPECTION/protocol.pdf" -o "$WORK/protokol.pdf"
head -c 5 "$WORK/protokol.pdf" | grep -q '%PDF-' || { echo "PDF protokol se nevytvořil."; exit 1; }
echo "PDF protokol: $(wc -c < "$WORK/protokol.pdf") B"

if diff "$WORK/before.txt" "$WORK/after.txt"; then
  echo "Test obnovy: data i fotky po obnově sedí."
else
  echo "Test obnovy SELHAL: data po obnově se liší."
  exit 1
fi
