#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixture="$(bash "$repo_root/scripts/generate-video-editor-benchmark-fixture.sh")"
OPENPOST_VIDEO_EDITOR_BENCHMARK_SOURCE="$fixture" \
  bunx playwright test --config playwright.app.config.ts \
  e2e-app/video-editor-performance.spec.ts --workers=1
