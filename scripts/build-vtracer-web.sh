#!/bin/sh
# Rebuild the PICTOS VTracer 1.0 web binding into lib/vtracer-web/pkg.
# Requires rustup target wasm32-unknown-unknown and wasm-pack. The core is
# pinned by git rev in lib/vtracer-web/Cargo.toml and Cargo.lock.
set -e
cd "$(dirname "$0")/../lib/vtracer-web"
wasm-pack build --release --target web --out-dir pkg
rm -f pkg/.gitignore pkg/package.json pkg/README.md
shasum -a 256 pkg/vtracer_web_bg.wasm
