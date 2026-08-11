#!/usr/bin/env bash
set -euo pipefail

mode="${1:?usage: ci-timing-summary.sh start|finish LABEL}"
label="${2:?usage: ci-timing-summary.sh start|finish LABEL}"
stamp="${RUNNER_TEMP:-/tmp}/openpost-ci-start-${label//[^a-zA-Z0-9_.-]/-}"

case "$mode" in
  start)
    date +%s > "$stamp"
    ;;
  finish)
    started="$(cat "$stamp")"
    elapsed="$(( $(date +%s) - started ))"
    minutes="$(( elapsed / 60 ))"
    seconds="$(( elapsed % 60 ))"
    printf '## Job timing\n\n| Job | Wall time |\n| --- | ---: |\n| %s | %dm %02ds |\n' "$label" "$minutes" "$seconds" >> "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 1
    ;;
esac
