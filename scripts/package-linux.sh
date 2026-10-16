#!/usr/bin/env bash
set -euo pipefail
studio_repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$studio_repo"
npm run typecheck
npm run lint
npm run build
bash scripts/publish-aot.sh
npm ci --prefix artifacts/linux/workers --omit=dev --ignore-scripts --cache "${STUDIO_NPM_CACHE:-$studio_repo/.local/cache/npm}"
rm -rf artifacts/linux/wwwroot/editor artifacts/linux/wwwroot/player
mkdir -p artifacts/linux/wwwroot/editor artifacts/linux/wwwroot/player
cp -a apps/editor/dist/. artifacts/linux/wwwroot/editor/
cp -a apps/player/dist/. artifacts/linux/wwwroot/player/
cp docs/studio-2.2-design.md artifacts/linux/ARCHITECTURE.md
cp docs/third-party-converters.md artifacts/linux/CONVERTERS.md
cp docs/acceptance/studio-2.2.md artifacts/linux/STUDIO-2.2-ACCEPTANCE.md
cp docs/studio-product-design.md artifacts/linux/PRODUCT.md
cp docs/acceptance/linux.md artifacts/linux/ACCEPTANCE.md
cp docs/linux-delivery.md artifacts/linux/README.md
cp -a server/migrations artifacts/linux/migrations-source
if [[ -f artifacts/showroom.studio.zip ]]; then
  mkdir -p artifacts/linux/examples
  cp artifacts/showroom.studio.zip artifacts/linux/examples/showroom.studio.zip
fi
if [[ -d .local/tools/ifc/ifcopenshell ]]; then
  mkdir -p artifacts/linux/tools/ifc
  cp -a .local/tools/ifc/. artifacts/linux/tools/ifc/
fi
if [[ -d .local/tools/ktx/KTX-Software-4.4.2-Linux-x86_64 ]]; then
  mkdir -p artifacts/linux/tools/ktx
  cp -a .local/tools/ktx/KTX-Software-4.4.2-Linux-x86_64/. artifacts/linux/tools/ktx/
fi
cp scripts/run-bundle.sh artifacts/linux/run.sh
chmod +x artifacts/linux/run.sh
if [[ -d artifacts/acceptance ]]; then
  mkdir -p artifacts/linux/acceptance
  cp -a artifacts/acceptance/. artifacts/linux/acceptance/
fi
chmod -R a+rX artifacts/linux
(cd artifacts/linux && find . -type f ! -name SHA256SUMS ! -name '*.dbg' ! -path './.jobs/*' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
rm -f artifacts/webgl-studio-linux-x64.zip
(cd artifacts && zip -qr webgl-studio-linux-x64.zip linux -x '*.dbg' 'linux/.jobs/*')
printf '%s\n' "$studio_repo/artifacts/webgl-studio-linux-x64.zip"
