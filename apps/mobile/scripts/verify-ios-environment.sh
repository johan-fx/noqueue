#!/bin/sh
# Fail before packaging a development server in a distributable iOS build.
set -eu
config="${SRCROOT}/App/capacitor.config.json"
if [ "${CONFIGURATION:-}" != 'Debug' ] && /usr/bin/plutil -extract server.url raw -o - "$config" >/dev/null 2>&1; then
  echo 'error: Live reload server.url is forbidden outside Debug. Run cap copy ios without local environment variables.' >&2
  exit 1
fi
