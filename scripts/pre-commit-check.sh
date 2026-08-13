#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
OPENPOST_COMMIT_CHECK_STAGED_ONLY=1 bash scripts/commit-check.sh
