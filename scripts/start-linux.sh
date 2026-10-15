#!/usr/bin/env bash
set -euo pipefail
studio_repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$studio_repo"
python3 scripts/configure-local.py
source .local/config.sh
export TMPDIR="$studio_repo/.local/staging"
exec artifacts/linux/Studio.Api --urls http://127.0.0.1:18080 --contentRoot "$studio_repo/artifacts/linux"
