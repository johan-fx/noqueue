#!/bin/sh
# Xcode build phase: optional, client-only plist. Missing configuration must not
# break OFF builds and must remove stale config from a reused build directory.
set -eu
/bin/sh "$(dirname "$0")/verify-ios-environment.sh"

# Local-network consent is strictly a development-build concern. Xcode has
# already copied/compiled the source Info.plist by the time this phase runs;
# edit only that build product, never the tracked source plist.
if [ -n "${INFOPLIST_PATH:-}" ]; then
  built_info_plist="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
  if [ ! -f "$built_info_plist" ]; then
    echo "error: built Info.plist was not found at $built_info_plist" >&2
    exit 1
  fi
  local_network_description='NoQueue uses the local network only to connect to a development server during local development and testing.'
  if [ "${CONFIGURATION:-}" = 'Debug' ]; then
    if /usr/bin/plutil -extract NSLocalNetworkUsageDescription raw -o - "$built_info_plist" >/dev/null 2>&1; then
      /usr/bin/plutil -replace NSLocalNetworkUsageDescription -string "$local_network_description" "$built_info_plist"
    else
      /usr/bin/plutil -insert NSLocalNetworkUsageDescription -string "$local_network_description" "$built_info_plist"
    fi
  elif /usr/bin/plutil -extract NSLocalNetworkUsageDescription raw -o - "$built_info_plist" >/dev/null 2>&1; then
    /usr/bin/plutil -remove NSLocalNetworkUsageDescription "$built_info_plist"
  fi
fi

source_file="${SRCROOT}/App/GoogleService-Info.plist"
target_file="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist"
if [ ! -f "$source_file" ]; then
  rm -f "$target_file"
  exit 0
fi
read_field() { /usr/bin/plutil -extract "$1" raw -o - "$source_file"; }
[ "$(read_field PROJECT_ID)" = 'nq-app-f3127' ]
[ "$(read_field BUNDLE_ID)" = 'com.noqueue-app.ios' ]
[ "$(read_field GCM_SENDER_ID)" = '54689871019' ]
mkdir -p "$(dirname "$target_file")"
cp "$source_file" "$target_file"
