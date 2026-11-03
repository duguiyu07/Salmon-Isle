#!/bin/sh
set -eu
umask 077
[ "$#" -eq 1 ] || { echo 'Usage: sh scripts/restore-site.sh /absolute/path/data.tar.gz' >&2; exit 1; }
case "$1" in /*) archive=$1 ;; *) echo 'Use an absolute archive path.' >&2; exit 1 ;; esac
[ -f "$archive" ] || { echo 'Archive not found.' >&2; exit 1; }
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
backup="$project/backups/restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
tar -tzf "$archive" > "$backup/entries.txt"
while IFS= read -r name; do
    case "$name" in data|data/*) ;; *) echo 'Archive must contain only data/.' >&2; exit 1 ;; esac
    case "/$name/" in */../*|*/./../*) echo 'Unsafe archive path.' >&2; exit 1 ;; esac
done < "$backup/entries.txt"
tar -tvzf "$archive" > "$backup/types.txt"
while IFS= read -r line; do
    case "$line" in d*|-*) ;; *) echo 'Archive links and special files are not supported.' >&2; exit 1 ;; esac
done < "$backup/types.txt"
mkdir "$backup/extracted"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$backup/extracted"
[ -d "$backup/extracted/data" ] && [ ! -L "$backup/extracted/data" ] || { echo 'Missing data directory.' >&2; exit 1; }
if [ -n "$(find "$backup/extracted/data" -type l -print -quit)" ]; then echo 'Data contains symlinks.' >&2; exit 1; fi
chown -R 1000:1000 "$backup/extracted/data"
docker compose stop blog
mv data "$backup/previous-data"
mv "$backup/extracted/data" data
printf '%s\n' '{"restored":true}' > data/sync-restored.json
if ! docker compose up -d --no-deps --wait --wait-timeout 120 blog; then
    docker compose stop blog
    mv data "$backup/failed-data"
    mv "$backup/previous-data" data
    docker compose up -d --no-deps --wait --wait-timeout 120 blog
    echo "Restore failed; previous data restored. See $backup" >&2
    exit 1
fi
echo "Data restored. Previous data retained at $backup/previous-data"
