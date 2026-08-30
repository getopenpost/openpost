#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--all-history" ]; }; then
  echo "Usage: scripts/scan-secrets.sh [--all-history]" >&2
  exit 2
fi

expected_version="${OPENPOST_GITLEAKS_VERSION:-8.30.1}"
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "secret-scan: gitleaks is required; use the project Devenv" >&2
  exit 1
fi
actual_version="$(gitleaks version)"
if [ "$actual_version" != "$expected_version" ]; then
  echo "secret-scan: expected gitleaks $expected_version, found $actual_version" >&2
  exit 1
fi
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "secret-scan: complete Git history is required" >&2
  exit 1
fi

redacted_flags=(--redact=100 --verbose --no-banner --no-color --timeout=300)
if [ "${1:-}" = "--all-history" ]; then
  log_options="--full-history --all --diff-filter=tuxdb"
else
  head_revision="${OPENPOST_SECRET_SCAN_HEAD:-HEAD}"
  base_revision="${OPENPOST_SECRET_SCAN_BASE:-}"
  if ! git rev-parse --verify --quiet "$head_revision^{commit}" >/dev/null; then
    echo "secret-scan: candidate head is not a commit" >&2
    exit 1
  fi
  if [ -z "$base_revision" ] || ! git rev-parse --verify --quiet "$base_revision^{commit}" >/dev/null; then
    base_revision="$(git merge-base "$head_revision" origin/main 2>/dev/null || true)"
  fi
  if [ -z "$base_revision" ]; then
    base_revision="$(git rev-parse "$head_revision^" 2>/dev/null || true)"
  fi
  if [ -n "$base_revision" ]; then
    log_options="--full-history --diff-filter=tuxdb $base_revision..$head_revision"
  else
    log_options="--max-count=1 --diff-filter=tuxdb $head_revision"
  fi
fi

gitleaks git "${redacted_flags[@]}" --log-opts="$log_options" "$root"
gitleaks dir "${redacted_flags[@]}" "$root"

echo "secret-scan: candidate history and current files passed"
