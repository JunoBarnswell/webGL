#!/usr/bin/env bash
set -euo pipefail
studio_repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$studio_repo"
mkdir -p .local/buildx
export BUILDX_CONFIG="$studio_repo/.local/buildx"
case "${1:-up}" in
  build)
    studio_ca="${CODEX_PROXY_CERT:-/etc/ssl/certs/ca-certificates.crt}"
    docker build --secret "id=proxy_ca,src=$studio_ca" -f infrastructure/Dockerfile.minio -t webgl-studio/minio:2025-09-07 .
    docker build --secret "id=proxy_ca,src=$studio_ca" -f infrastructure/Dockerfile.aot -t webgl-studio/aot-sdk:10.0 .
    ;;
  up)
    python3 scripts/configure-local.py
    docker network inspect webgl-studio-v1 >/dev/null 2>&1 || docker network create webgl-studio-v1 >/dev/null
    if ! docker container inspect webgl-studio-mysql >/dev/null 2>&1; then
      docker run -d --name webgl-studio-mysql --network webgl-studio-v1 --env-file .local/config.env \
        -p 127.0.0.1:13306:3306 --mount "type=bind,src=$studio_repo/.local/data/mysql,dst=/var/lib/mysql" \
        --health-cmd='mysqladmin ping -h 127.0.0.1 --silent' --health-interval=5s --health-retries=24 \
        mysql:8.0.44@sha256:9c3380eac945af0736031b200027f581925927c81e010056214a4bd6b6693714 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci >/dev/null
    else docker start webgl-studio-mysql >/dev/null; fi
    if ! docker container inspect webgl-studio-minio >/dev/null 2>&1; then
      docker run -d --name webgl-studio-minio --network webgl-studio-v1 --env-file .local/config.env \
        -p 127.0.0.1:19000:9000 -p 127.0.0.1:19001:9001 \
        --mount "type=bind,src=$studio_repo/.local/data/minio,dst=/data" webgl-studio/minio:2025-09-07 >/dev/null
    else docker start webgl-studio-minio >/dev/null; fi
    studio_ready=false
    for studio_attempt in $(seq 1 120); do
      if [[ "$(docker inspect --format '{{.State.Health.Status}}' webgl-studio-mysql)" == healthy ]] && curl --silent --fail http://127.0.0.1:19000/minio/health/ready >/dev/null; then
        studio_ready=true
        break
      fi
      sleep 1
    done
    if [[ "$studio_ready" != true ]]; then
      printf '%s\n' 'Studio service readiness timed out; inspect docker logs webgl-studio-mysql and webgl-studio-minio.' >&2
      exit 1
    fi
    printf '%s\n' 'Studio services ready: MySQL 127.0.0.1:13306, MinIO 127.0.0.1:19000.'
    ;;
  stop)
    docker stop webgl-studio-mysql webgl-studio-minio >/dev/null
    ;;
  status)
    docker ps --filter name=webgl-studio --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    ;;
  *) printf '%s\n' 'Usage: bash scripts/services.sh build|up|stop|status' >&2; exit 2 ;;
esac
