#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
govulncheck_version="v1.6.0"

# GO-2026-6875 (Proxy middleware forwards X-Real-IP) and GO-2026-6872
# (RateLimiter keyed on spoofable X-Forwarded-For) are fixed only in echo v5.
# OpenPost uses neither echo middleware; the guard below keeps it that way.
# Remove these admissions after the echo v5 migration.
admitted_go_vulns="GO-2026-6875 GO-2026-6872"

if git -C "$repo_root" grep -nE 'middleware\.(Proxy|ProxyWithConfig|RateLimiter|RateLimiterWithConfig)\(' -- 'apps/server/*.go'; then
  echo "echo Proxy/RateLimiter middleware is used; revoke the GO-2026-6875/6872 admission" >&2
  exit 1
fi

govulncheck() {
  local findings
  findings=$(go run "golang.org/x/vuln/cmd/govulncheck@${govulncheck_version}" -format json "$@" |
    jq -r 'select(.finding != null and .finding.trace[0].function != null) | .finding.osv' | sort -u)
  local failed=0
  for id in $findings; do
    if [[ " $admitted_go_vulns " == *" $id "* ]]; then
      echo "admitted: $id"
    else
      echo "vulnerable: $id (https://pkg.go.dev/vuln/$id)" >&2
      failed=1
    fi
  done
  return "$failed"
}

(cd "$repo_root/apps/server" && govulncheck -tags dev ./...)
(cd "$repo_root/apps/cli" && govulncheck ./...)

cd "$repo_root"
scripts/bun-audit.sh
