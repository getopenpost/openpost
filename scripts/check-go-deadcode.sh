#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deadcode_version="v0.44.0"

run_deadcode() {
  go run "golang.org/x/tools/cmd/deadcode@${deadcode_version}" -test ./...
}

for module in backend cli; do
  output="$(cd "${repository_root}/${module}" && run_deadcode)"
  if [[ -n "${output//[[:space:]]/}" ]]; then
    printf 'Unreachable Go declarations in %s:\n%s\n' "${module}" "${output}" >&2
    exit 1
  fi
done

printf 'Checked backend and CLI packages with deadcode -test.\n'
