#!/bin/sh
# Engine-only build: no demo UI, MODULARIZE'd output suitable for use
# inside a Web Worker (or Node for build-time precomputation).
#
# Requires an activated Emscripten environment (tested with emsdk 2.0.23):
#   source /path/to/emsdk/emsdk_env.sh   (or emsdk_env.bat on Windows)
#   ./build_engine.sh

set -e

mkdir -p dist

emcc gnubg/*.c gnubg/lib/*.c glib/glib-2.62.0/glib/*.c glib/glib-2.62.0/glib/libcharset/*.c \
  -O2 \
  -o dist/gnubg-engine.js \
  --preload-file packaged_files@/ \
  -s MODULARIZE=1 \
  -s 'EXPORT_NAME="createGnubgModule"' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s 'EXPORTED_RUNTIME_METHODS=["getValue","setValue","ccall","cwrap","UTF8ToString"]' \
  -s ENVIRONMENT=web,worker,node \
  -DGLIB_COMPILATION=1 -DWEB=1 \
  -I glib/glib-2.62.0/glib/ \
  -I glib/glib-2.62.0/ \
  -I glib/glib-2.62.0/_build/glib \
  -I gnubg/lib/ \
  -I gnubg/ \
  -I glib/glib-2.62.0/_build/ \
  -I glib/glib-2.62.0/glib/libcharset/

# Emscripten 2.0.23 stubs getpwuid with a throwing TODO; neutralise it.
# https://github.com/emscripten-core/emscripten/issues/13219
# Also neutralise _tzset: its helpers (__get_timezone etc.) are not emitted
# by this emscripten version, and gnubg does not need the C timezone globals.
sed -e 's/throw"getpwuid: TODO"/return 0/g' -e "s/throw 'getpwuid: TODO'/return 0/g" \
    -e 's/function _tzset(){if(_tzset\.called)return;/function _tzset(){return;/' \
    -e 's/var zonePtr=HEAP32\[__get_tzname()+(dst?4:0)>>2\];HEAP32\[tmPtr+40>>2\]=zonePtr/HEAP32[tmPtr+40>>2]=0/' \
  < dist/gnubg-engine.js > dist/gnubg-engine.fixed.js
mv dist/gnubg-engine.fixed.js dist/gnubg-engine.js

cp js/engine.worker.js dist/engine.worker.js
cp js/engine-client.js dist/engine-client.js

echo "Build OK: dist/gnubg-engine.js dist/gnubg-engine.wasm dist/gnubg-engine.data"
