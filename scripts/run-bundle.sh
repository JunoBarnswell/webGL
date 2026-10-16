#!/usr/bin/env bash
set -euo pipefail
studio_bundle="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${STUDIO_MYSQL:-}" ] || [ -z "${STUDIO_S3_SECRET_KEY:-}" ] || [ -z "${STUDIO_ADMIN_PASSWORD:-}" ] || [ -z "${STUDIO_JWT_KEY:-}" ]; then
  printf '%s\n' 'Inject STUDIO_* configuration described in README.md before starting.' >&2
  exit 2
fi
export STUDIO_WORKER_ROOT="${STUDIO_WORKER_ROOT:-$studio_bundle/workers}"
export STUDIO_JOB_ROOT="${STUDIO_JOB_ROOT:-$studio_bundle/.jobs}"
if [[ -x "$studio_bundle/tools/ktx/bin/toktx" ]]; then export STUDIO_TOKTX="${STUDIO_TOKTX:-$studio_bundle/tools/ktx/bin/toktx}"; fi
if [[ -d "$studio_bundle/tools/ifc/ifcopenshell" ]]; then export STUDIO_IFC_MODULES="${STUDIO_IFC_MODULES:-$studio_bundle/tools/ifc}"; fi
exec "$studio_bundle/Studio.Api" --urls "${STUDIO_URLS:-http://127.0.0.1:18080}" --contentRoot "$studio_bundle"
