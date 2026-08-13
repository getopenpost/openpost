#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: verify-image-release-manifest.sh IMAGE RELEASE_MANIFEST}"
manifest="${2:?usage: verify-image-release-manifest.sh IMAGE RELEASE_MANIFEST}"

expected_version="$(jq -er '.version' "$manifest")"
expected_revision="$(jq -er '.revision' "$manifest")"
expected_manifest_sha256="$(openssl dgst -sha256 -r "$manifest" | awk '{print $1}')"

actual_version="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")"
actual_revision="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
actual_manifest_sha256="$(docker inspect --format '{{ index .Config.Labels "io.openpost.release-manifest.sha256" }}' "$image")"

[[ "$actual_version" == "$expected_version" ]] || {
  printf 'expected image version %s, got %s\n' "$expected_version" "$actual_version" >&2
  exit 1
}
[[ "$actual_revision" == "$expected_revision" ]] || {
  printf 'expected image revision %s, got %s\n' "$expected_revision" "$actual_revision" >&2
  exit 1
}
[[ "$actual_manifest_sha256" == "$expected_manifest_sha256" ]] || {
  printf 'expected image release-manifest digest %s, got %s\n' \
    "$expected_manifest_sha256" "$actual_manifest_sha256" >&2
  exit 1
}

embedded_manifest="$(mktemp)"
trap 'rm -f "$embedded_manifest"' EXIT
docker run --rm "$image" cat /app/release-manifest.json >"$embedded_manifest"
cmp -s "$manifest" "$embedded_manifest" || {
  printf 'embedded release manifest does not match %s\n' "$manifest" >&2
  exit 1
}
