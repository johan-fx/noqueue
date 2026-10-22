#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
directory="$PWD/reports/android-local/tls"
mkdir -p "$directory/res/raw"
chmod 700 "$directory"
if [[ ! -f "$directory/server.key" || ! -f "$directory/res/raw/noqueue_local_ca.pem" ]]; then
  umask 077
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
    -subj '/CN=NoQueue local emulator only' \
    -addext 'subjectAltName=IP:127.0.0.1' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -keyout "$directory/server.key" -out "$directory/res/raw/noqueue_local_ca.pem"
fi
openssl x509 -checkend 3600 -noout -in "$directory/res/raw/noqueue_local_ca.pem"
printf '\nLocal TLS directory: %s\n' "$directory"
