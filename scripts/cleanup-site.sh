#!/bin/sh
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
# Compose targets this project only. Abort cleanup unless its current site is healthy.
docker compose exec -T blog node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
docker compose exec -T blog node - /data --apply < "$project/scripts/cleanup-data.cjs"
backup_root="$project/backups"
if [ -L "$backup_root" ]; then echo "Refusing symlink backup directory" >&2; exit 1; fi
for backup in "$backup_root"/program-*; do
  [ -d "$backup" ] || continue
  [ ! -L "$backup" ] || { echo "Refusing symlink backup" >&2; exit 1; }
  # Expansion is bounded by the canonical project directory and a literal prefix.
  rm -rf -- "$backup"
done
current=$(docker compose images -q blog)
for tag in $(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^(ghcr.io/duguiyu07/salmon-isle:|salmon-isle-rollback:)' || true); do
  id=$(docker image inspect --format '{{.Id}}' "$tag")
  current_id=$(docker image inspect --format '{{.Id}}' "$current")
  [ "$id" != "$current_id" ] || continue
  # All containers, including stopped ones, protect an image from removal.
  [ -z "$(docker ps -aq --filter "ancestor=$id")" ] || continue
  docker image rm "$tag"
done
echo "Website history cleanup completed. Current library and running images retained."
