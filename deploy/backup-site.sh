#!/bin/sh
set -eu
umask 077
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
backup="$project/backups/manual-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
docker compose config > "$backup/compose.yml"
[ ! -f .env ] || cp .env "$backup/previous.env"
docker compose stop blog
restart() { docker compose up -d --no-deps --wait --wait-timeout 120 blog; }
trap 'restart' EXIT
tar -czf "$backup/data.tar.gz" data
(cd "$backup" && sha256sum data.tar.gz > SHA256SUMS.txt)
echo "Backup saved: $backup"
