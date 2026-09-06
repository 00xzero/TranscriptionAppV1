#!/bin/sh

set -eu

lockfile_hash_file="/app/node_modules/.package-lock.sha256"
current_lockfile_hash="$(sha256sum /app/package-lock.json | awk '{print $1}')"
installed_lockfile_hash=""

if [ -f "$lockfile_hash_file" ]; then
    installed_lockfile_hash="$(cat "$lockfile_hash_file")"
fi

if [ "$installed_lockfile_hash" != "$current_lockfile_hash" ]; then
    if [ "${OFFLINE_MODE:-0}" = "1" ]; then
        echo "Cannot refresh frontend dependencies while offline." >&2
        echo "Reconnect and run: cd infra && ./start-local.sh --prepare-offline" >&2
        exit 1
    fi

    echo "package-lock.json changed; refreshing container dependencies..."
    npm ci
    printf '%s\n' "$current_lockfile_hash" > "$lockfile_hash_file"

    if [ -d /app/.next ]; then
        find /app/.next -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    fi
fi

exec npm run dev
