#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixture_dir="${OPENPOST_VIDEO_EDITOR_BENCHMARK_DIR:-$repo_root/.devenv/state/video-editor-benchmarks}"
fixture="$fixture_dir/1080p60-1h.mp4"
seed="$fixture_dir/1080p60-2s-seed.mp4"
mkdir -p "$fixture_dir"

valid_fixture() {
  [[ -f "$fixture" ]] || return 1
  local probe
  probe="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -show_entries format=duration -of default=noprint_wrappers=1 "$fixture")"
  [[ "$probe" == *"width=1920"* ]]
  [[ "$probe" == *"height=1080"* ]]
  [[ "$probe" == *"avg_frame_rate=60/1"* ]]
  local duration
  duration="$(printf '%s\n' "$probe" | sed -n 's/^duration=//p')"
  awk -v duration="$duration" 'BEGIN { exit !(duration >= 3599 && duration <= 3601) }'
}

if valid_fixture; then
  printf '%s\n' "$fixture"
  exit 0
fi

temporary="$fixture.partial.mp4"
rm -f "$seed" "$temporary"

ffmpeg -hide_banner -loglevel warning -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=60:duration=2" \
  -an -c:v libx264 -preset veryfast -profile:v high -level:v 4.2 \
  -pix_fmt yuv420p -b:v 450k -maxrate 450k -bufsize 900k -g 120 -keyint_min 120 \
  -movflags +faststart "$seed"

ffmpeg -hide_banner -loglevel warning -y \
  -stream_loop 1799 -i "$seed" -t 3600 -map 0:v:0 -c copy -movflags +faststart \
  "$temporary"

mv "$temporary" "$fixture"
if ! valid_fixture; then
  printf 'Generated fixture failed metadata validation: %s\n' "$fixture" >&2
  exit 1
fi
printf '%s\n' "$fixture"
