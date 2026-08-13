#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
govulncheck_version="v1.6.0"

cd "$repo_root/backend"
go run "golang.org/x/vuln/cmd/govulncheck@${govulncheck_version}" -tags dev ./...

cd "$repo_root/cli"
go run "golang.org/x/vuln/cmd/govulncheck@${govulncheck_version}" ./...

cd "$repo_root"
scripts/bun-audit.sh
