#!/usr/bin/env bash
set -euo pipefail
studio_repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$studio_repo"
mkdir -p artifacts/linux .local/cache/nuget .local/logs
studio_ca="${CODEX_PROXY_CERT:-/etc/ssl/certs/ca-certificates.crt}"
docker run --rm \
  --mount "type=bind,src=$studio_repo,dst=/src" \
  --mount "type=bind,src=$studio_repo/.local/cache/nuget,dst=/root/.nuget/packages" \
  --mount "type=bind,src=$studio_ca,dst=/run/proxy-ca.pem,readonly" \
  -e SSL_CERT_FILE=/run/proxy-ca.pem -e DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  -e STUDIO_PUBLISH_OWNER="$(id -u):$(id -g)" \
  webgl-studio/aot-sdk:10.0 sh -c 'dotnet publish server/Studio.Api/Studio.Api.csproj -c Release -r linux-x64 -p:PublishAot=true -o /src/artifacts/linux && chmod -R a+rX /src/artifacts/linux && chown -R "$STUDIO_PUBLISH_OWNER" /src/artifacts/linux' 2>&1 | tee .local/logs/publish-aot.log
