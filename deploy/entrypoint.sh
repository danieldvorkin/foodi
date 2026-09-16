#!/bin/sh
# Fly mounts the volume as root. Give it to the unprivileged user, then drop privileges.
set -eu
DATA_DIR="$(dirname "${FOODI_DB_PATH:-/data/foodi.db}")"
mkdir -p "$DATA_DIR" "${FOODI_UPLOAD_DIR:-/data/uploads}"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
