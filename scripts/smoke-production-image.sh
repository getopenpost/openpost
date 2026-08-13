#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: smoke-production-image.sh IMAGE [EXPECTED_COMMIT [EXPECTED_VERSION [RELEASE_MANIFEST]]]}"
expected_commit="${2:-}"
expected_version="${3:-}"
release_manifest="${4:-}"
container="openpost-smoke-${RANDOM}-$$"
port="${OPENPOST_SMOKE_PORT:-18080}"
database_volume="openpost-smoke-db-${RANDOM}-$$"
smoke_jwt_secret="$(openssl rand -hex 32)"
smoke_encryption_key="$(openssl rand -hex 16)"
smoke_environment=(
  --env "OPENPOST_APP_URL=http://127.0.0.1:${port}"
  --env "OPENPOST_JWT_SECRET=${smoke_jwt_secret}"
  --env "OPENPOST_ENCRYPTION_KEY=${smoke_encryption_key}"
)

expected_platform="$(jq -er '.supported_platforms | if length == 1 then .[0] else error("smoke requires exactly one supported platform") end' docker/image-policy.json)"
expected_architecture="${expected_platform#linux/}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm -f "$database_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_probes() {
  local phase="$1"
  for _ in $(seq 1 60); do
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container" 2>/dev/null || true)"
    if curl --fail --silent --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/health" >/dev/null &&
      curl --fail --silent --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/ready" >/dev/null &&
      [[ "$health_status" == "healthy" ]]; then
      return 0
    fi
    sleep 1
  done

  printf 'production image did not become live, ready, and OCI-healthy during %s\n' "$phase" >&2
  docker inspect --format 'state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" >&2 || true
  docker logs "$container" >&2 || true
  return 1
}

docker volume create "$database_volume" >/dev/null

actual_architecture="$(docker image inspect --format '{{.Architecture}}' "$image")"
[[ "$actual_architecture" == "$expected_architecture" ]] || {
  printf 'expected %s image architecture, got %s\n' "$expected_architecture" "$actual_architecture" >&2
  exit 1
}

# Exercise the runtime dependencies used by SQLite storage and media analysis.
docker run --rm --entrypoint sh "$image" -ec '
  sqlite3 :memory: "select 1" >/dev/null
  ffprobe -version >/dev/null
  ffmpeg -hide_banner -loglevel error -f lavfi -i color=size=16x16:rate=1 -frames:v 1 -f null -
'

# Exercise the same no-side-effect configuration check used by the production
# deployment gate before starting a database-backed container.
docker run --rm "${smoke_environment[@]}" "$image" ./openpost check-config >/dev/null

docker run --detach --name "$container" \
  --publish "127.0.0.1:${port}:8080" \
  --volume "$database_volume:/data/db" \
  "${smoke_environment[@]}" \
  "$image" >/dev/null

wait_for_probes "initial start"
curl --fail --show-error --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/health"
curl --fail --show-error --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/ready"

docker restart "$container" >/dev/null
wait_for_probes "restart"
curl --fail --show-error --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/health"
curl --fail --show-error --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/ready"

if [[ -n "$expected_commit" ]]; then
  actual_commit="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
  [[ "$actual_commit" == "$expected_commit" ]] || {
    printf 'expected image revision %s, got %s\n' "$expected_commit" "$actual_commit" >&2
    exit 1
  }
  running_commit="$(curl --fail --silent --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/version" | jq -r .revision)"
  [[ "$running_commit" == "$expected_commit" ]] || {
    printf 'expected running revision %s, got %s\n' "$expected_commit" "$running_commit" >&2
    exit 1
  }
fi

if [[ -n "$expected_version" ]]; then
  actual_version="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")"
  [[ "$actual_version" == "$expected_version" ]] || {
    printf 'expected image version %s, got %s\n' "$expected_version" "$actual_version" >&2
    exit 1
  }
  running_version="$(curl --fail --silent --connect-timeout 1 --max-time 2 "http://127.0.0.1:${port}/api/v1/version" | jq -r .version)"
  [[ "$running_version" == "$expected_version" ]] || {
    printf 'expected running version %s, got %s\n' "$expected_version" "$running_version" >&2
    exit 1
  }
fi

if [[ -n "$release_manifest" ]]; then
  scripts/verify-image-release-manifest.sh "$image" "$release_manifest"
fi
