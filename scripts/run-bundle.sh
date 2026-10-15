#!/usr/bin/env bash
set -euo pipefail
studio_bundle="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${STUDIO_MYSQL:-}" ] || [ -z "${STUDIO_S3_SECRET_KEY:-}" ] || [ -z "${STUDIO_ADMIN_PASSWORD:-}" ] || [ -z "${STUDIO_JWT_KEY:-}" ]; then
  printf '%s\n' 'Inject STUDIO_* configuration described in README.md before starting.' >&2
  exit 2
fi
exec "$studio_bundle/Studio.Api" --urls "${STUDIO_URLS:-http://127.0.0.1:18080}" --contentRoot "$studio_bundle"
