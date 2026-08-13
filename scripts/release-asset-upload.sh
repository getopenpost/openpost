#!/usr/bin/env bash

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: release-asset-upload.sh <asset> [<asset> ...]" >&2
  exit 2
fi

: "${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

retry_delay_seconds="${OPENPOST_RELEASE_ASSET_RETRY_DELAY_SECONDS:-3}"
[[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || {
  echo "OPENPOST_RELEASE_ASSET_RETRY_DELAY_SECONDS must be a non-negative integer." >&2
  exit 2
}

upload_timeout_seconds="${OPENPOST_RELEASE_ASSET_UPLOAD_TIMEOUT_SECONDS:-600}"
[[ "$upload_timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "OPENPOST_RELEASE_ASSET_UPLOAD_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
}

expected_state=$'true\tfalse\t'"$GITHUB_REF_NAME"
release_state=""

for attempt in $(seq 1 20); do
  if release_state="$(gh release view "$GITHUB_REF_NAME" \
    --repo "$GITHUB_REPOSITORY" \
    --json isDraft,isPrerelease,tagName \
    --jq '[.isDraft, .isPrerelease, .tagName] | @tsv' 2>/dev/null)" &&
    [[ "$release_state" == "$expected_state" ]]; then
    break
  fi

  if [[ "$attempt" -eq 20 ]]; then
    echo "The draft release did not become visible with the expected state." >&2
    exit 1
  fi

  echo "Draft release is not visible yet; retrying (${attempt}/20)." >&2
  sleep "$retry_delay_seconds"
done

upload_assets() {
  gh release upload "$GITHUB_REF_NAME" \
    --repo "$GITHUB_REPOSITORY" \
    --clobber \
    "$@" &
  local upload_pid=$!

  (
    for ((elapsed = 0; elapsed < upload_timeout_seconds; elapsed++)); do
      kill -0 "$upload_pid" 2>/dev/null || exit 0
      sleep 1
    done

    echo "Release asset upload timed out after ${upload_timeout_seconds} seconds." >&2
    kill -TERM "$upload_pid" 2>/dev/null || exit 0
    sleep 5
    kill -KILL "$upload_pid" 2>/dev/null || true
  ) &
  local watchdog_pid=$!

  local upload_status=0
  wait "$upload_pid" || upload_status=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  return "$upload_status"
}

for attempt in $(seq 1 5); do
  if upload_assets "$@"; then
    exit 0
  fi

  if [[ "$attempt" -eq 5 ]]; then
    echo "Release asset upload failed after 5 attempts." >&2
    exit 1
  fi

  echo "Release asset upload failed; retrying (${attempt}/5)." >&2
  sleep $((attempt * retry_delay_seconds))
done
