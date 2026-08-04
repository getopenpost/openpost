#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixture="$(bash "$repo_root/scripts/generate-video-studio-benchmark-fixture.sh")"
OPENPOST_VIDEO_STUDIO_BENCHMARK_SOURCE="$fixture" \
  pnpm exec playwright test --config playwright.app.config.ts \
  e2e-app/video-studio-performance.spec.ts --workers=1
