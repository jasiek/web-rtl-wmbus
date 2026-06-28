#!/usr/bin/env bash
#
# Builds the wmbusmeters decoder to WebAssembly for the app.
#
# wmbusmeters ships an official Emscripten build under browser/ that compiles the
# whole CLI and exposes wm_main(cmdline). We reuse its compiled object files and
# libxml2.a, but re-link as an ES6 module (so the DSP worker can `import` it) and
# emit into src/wasm/.
#
# The official build.sh does the heavy lifting (libxml2 + compiling all of src/).
# We run it first if its objects are missing, then relink.
#
# Prereqs: native/emsdk, native/wmbusmeters (run native/setup.sh).
# macOS note: the official build.sh needs `nproc` and `libtoolize`; provide
# shims on PATH (e.g. nproc -> `sysctl -n hw.ncpu`, libtoolize -> glibtoolize).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WM="$HERE/wmbusmeters"
BROWSER="$WM/browser"
BUILD="$BROWSER/build"
LIBXML2_A="$WM/3rdparty/libxml2/.libs/libxml2.a"
OUT="$REPO/src/wasm"

# shellcheck disable=SC1091
source "$HERE/emsdk/emsdk_env.sh" >/dev/null 2>&1

# Compile everything via the upstream script if objects are not present yet.
if [ ! -f "$BUILD/bindings.o" ] || [ ! -f "$LIBXML2_A" ]; then
  echo "==> Object files missing; running upstream browser/build.sh first..."
  ( cd "$BROWSER" && bash build.sh )
fi

mkdir -p "$OUT"

echo "==> Relinking wmbusmeters as an ES6 module into src/wasm/ ..."
em++ \
  "$BUILD"/*.o \
  "$LIBXML2_A" \
  -flto \
  -lidbfs.js \
  -s FORCE_FILESYSTEM=1 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker,node \
  -s ASYNCIFY \
  -s ASYNCIFY_STACK_SIZE=1048576 \
  -s ASYNCIFY_IMPORTS='["emscripten_sleep","usleep"]' \
  -s EXPORT_NAME="WMBusMeters" \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s NO_EXIT_RUNTIME=1 \
  -s EXPORTED_FUNCTIONS='["_wm_version","_wm_main","_malloc","_free"]' \
  -o "$OUT/wmbusmeters.js"

echo "Built: $OUT/wmbusmeters.js + wmbusmeters.wasm"
