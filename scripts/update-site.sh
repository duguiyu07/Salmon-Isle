#!/bin/sh
set -eu
umask 077
new_image=''
local_image=false
retain_backup=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --image) [ "$#" -ge 2 ] || { echo "Missing image" >&2; exit 1; }; new_image=$2; shift 2 ;;
    --local) local_image=true; shift ;;
    --retain-backup) retain_backup=true; shift ;;
    *) echo "Usage: update-site.sh [--image ghcr.io/owner/source:version] [--local] [--retain-backup]" >&2; exit 1 ;;
  esac
done
if [ -n "$new_image" ]; then
  case "$new_image" in ghcr.io/*:*) ;; *) echo "Invalid program image" >&2; exit 1 ;; esac
  case "$new_image" in *[!a-zA-Z0-9._:/-]*) echo "Invalid program image" >&2; exit 1 ;; esac
elif [ "$local_image" = true ]; then echo "--local requires --image" >&2; exit 1
fi
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$project/backups/program-$stamp"
old_image=$(docker compose images -q blog)
if [ -z "$old_image" ]; then echo "No existing website container. Start the website first." >&2; exit 1; fi
rollback_image="salmon-isle-rollback:$stamp"
docker image tag "$old_image" "$rollback_image"
mkdir -p "$backup"
docker compose config > "$backup/compose.yml"
image=$(docker compose config --images blog)
if [ -n "$new_image" ]; then
  if [ "$local_image" = true ]; then docker image inspect "$new_image" >/dev/null; else docker pull "$new_image"; fi
elif [ "$image" = "salmon-isle:local" ]; then
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "Use --image with the image shown in the website update page." >&2; exit 1; fi
  git diff --quiet && git diff --cached --quiet || { echo "Commit or stash source edits first." >&2; exit 1; }
  git pull --ff-only
  docker compose build --pull blog
else docker compose pull blog; fi
printf 'services:\n  blog:\n    image: %s\n    pull_policy: never\n' "$rollback_image" > "$backup/rollback.yml"
restart_old() { docker compose -f "$project/compose.yml" -f "$backup/rollback.yml" up -d --no-deps --wait --wait-timeout 120 blog; }
docker compose stop blog
if ! tar -C "$project" -czf "$backup/data.tar.gz" data; then restart_old; echo "Backup failed; previous version restarted." >&2; exit 1; fi
if [ -n "$new_image" ]; then
  if [ -f .env ]; then cp .env "$backup/previous.env"; else touch .env; fi
  awk -v value="$new_image" 'BEGIN {found=0} /^SALMON_WEB_IMAGE=/ {print "SALMON_WEB_IMAGE=" value;found=1;next} {print} END {if(!found)print "SALMON_WEB_IMAGE=" value}' .env > .env.program-next
  mv .env.program-next .env
  export SALMON_WEB_IMAGE="$new_image"
fi
pull_option=''
if [ "$local_image" = true ]; then pull_option='--pull never'; fi
if ! docker compose up -d --no-deps $pull_option --wait --wait-timeout 120 blog; then
  if [ -f "$backup/previous.env" ]; then cp "$backup/previous.env" .env; fi
  docker compose stop blog
  if [ -d data ]; then mv data "$backup/failed-data"; fi
  tar -C "$project" -xzf "$backup/data.tar.gz"
  printf '%s\n' '{"restored":true}' > data/sync-restored.json
  export SALMON_WEB_IMAGE="$image"
  restart_old; echo "Update failed; previous image restored. Backup: $backup" >&2; exit 1
fi
if [ "$retain_backup" = true ]; then
  echo "Website updated. Temporary backup: $backup. Run scripts/cleanup-site.sh after verification."
else
  sh "$project/scripts/cleanup-site.sh"
  echo "Website updated. Persistent data retained; temporary program history cleaned."
fi
