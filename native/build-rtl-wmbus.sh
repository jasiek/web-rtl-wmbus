#!/usr/bin/env bash
#
# Compiles rtl-wmbus (via native/shim.c) to WebAssembly with Emscripten.
# Output: src/wasm/rtl_wmbus.{js,wasm}  (committed artifacts).
#
# Prereqs: native/emsdk (run native/setup.sh) and native/rtl-wmbus (cloned).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
RWM="$HERE/rtl-wmbus"
OUT="$REPO/src/wasm"

# shellcheck disable=SC1091
source "$HERE/emsdk/emsdk_env.sh" >/dev/null 2>&1

# rtl_wmbus.c #includes "build/version.h"; generate a minimal one.
mkdir -p "$RWM/build"
COMMIT="$(git -C "$RWM" log -1 --pretty=format:'%H' 2>/dev/null || echo unknown)"
cat > "$RWM/build/version.h" <<EOF
#define VERSION "wasm"
#define COMMIT "$COMMIT"
EOF

mkdir -p "$OUT"

emcc \
  -DNDEBUG -O3 -std=gnu99 \
  -I"$RWM" -I"$RWM/include" \
  "$HERE/shim.c" \
  -o "$OUT/rtl_wmbus.js" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_rtlwmbus_init","_rtlwmbus_feed","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8"]' \
  -sINVOKE_RUN=0 \
  -sSINGLE_FILE=1 \
  -sEXPORT_NAME=createRtlWmbus

echo "Built: $OUT/rtl_wmbus.js (wasm embedded, SINGLE_FILE)"
