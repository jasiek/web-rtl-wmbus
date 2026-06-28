#!/usr/bin/env bash
#
# One-time setup for the WASM build: clones upstream sources and the Emscripten
# SDK into native/ (all git-ignored). Run native/build-*.sh afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

clone() { # url dir [ref]
  local url="$1" dir="$2"
  if [ -d "$HERE/$dir/.git" ]; then
    echo "$dir already present, skipping."
  else
    git clone --depth 1 "$url" "$HERE/$dir"
  fi
}

clone https://github.com/xaelsouth/rtl-wmbus.git rtl-wmbus
clone https://github.com/wmbusmeters/wmbusmeters.git wmbusmeters
clone https://github.com/emscripten-core/emsdk.git emsdk

cd "$HERE/emsdk"
./emsdk install latest
./emsdk activate latest

echo
echo "Setup complete. Now run:"
echo "  ./native/build-rtl-wmbus.sh"
echo "  ./native/build-wmbusmeters.sh"
