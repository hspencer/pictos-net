#!/bin/sh
# Compatibility entrypoint: prepares local snapshots, never publishes remotely.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."
exec node "$SCRIPT_DIR/export-schema.mjs" "$@"
