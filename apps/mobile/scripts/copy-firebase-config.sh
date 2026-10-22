#!/bin/sh
# Xcode build phase: optional, client-only plist. Missing configuration must not
# break OFF builds and must remove stale config from a reused build directory.
set -eu
/bin/sh "$(dirname "$0")/verify-ios-environment.sh"
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
