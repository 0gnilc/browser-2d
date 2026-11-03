#!/usr/bin/env bash
set -euo pipefail

test -n "${DBUS_SESSION_BUS_ADDRESS:-}"
export XDG_CURRENT_DESKTOP=GNOME
export XDG_DATA_HOME
XDG_DATA_HOME=$(mktemp -d /tmp/browser-2d-keyring-data-XXXXXX)
export GNOME_KEYRING_CONTROL
GNOME_KEYRING_CONTROL=$(mktemp -d /tmp/browser-2d-keyring-control-XXXXXX)
gnome-keyring-daemon --foreground --unlock --components=secrets \
  --control-directory="$GNOME_KEYRING_CONTROL" < <(printf '%s' 'synthetic-ci-keyring-password') &
keyring_pid=$!
cleanup() {
  kill "$keyring_pid" 2>/dev/null || true
  wait "$keyring_pid" 2>/dev/null || true
  rm -rf "$XDG_DATA_HOME" "$GNOME_KEYRING_CONTROL"
}
trap cleanup EXIT
gdbus wait --session --timeout 10 org.freedesktop.secrets
"$@"
