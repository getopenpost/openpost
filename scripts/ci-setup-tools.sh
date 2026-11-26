#!/usr/bin/env bash
# Prepare CI browser and media tools without depending on Ubuntu apt mirrors,
# whose stalls were the most common cause of failed CI runs. Chromium reuses
# runner libraries when they are already satisfied. FFmpeg comes from a pinned,
# checksum-verified static build that the setup action caches between runs.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  media)
    if [[ $# != 1 ]]; then
      echo 'Usage: bash scripts/ci-setup-tools.sh media' >&2
      exit 2
    fi
    ;;
  chromium)
    if [[ $# != 2 || ( "$2" != full && "$2" != shell ) ]]; then
      echo 'Usage: bash scripts/ci-setup-tools.sh chromium <full|shell>' >&2
      exit 2
    fi
    chromium_mode="$2"
    ;;
  *)
    echo 'Usage: bash scripts/ci-setup-tools.sh <media|chromium <full|shell>>' >&2
    exit 2
    ;;
esac

if [[ "$mode" == chromium ]]; then
  flag=--no-shell
  [[ "$chromium_mode" == shell ]] && flag=--only-shell
  PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=60000 bunx --no-install playwright install "$flag" chromium

  chrome_bin=""
  if [[ "$chromium_mode" == shell ]]; then
    chrome_bin="$(find "${HOME}/.cache/ms-playwright" -type f -name 'chrome-headless-shell' -perm -111 2>/dev/null | head -1 || true)"
  else
    chrome_bin="$(find "${HOME}/.cache/ms-playwright" -type f -name 'chrome' -perm -111 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "$chrome_bin" ]] && ! ldd "$chrome_bin" 2>/dev/null | grep -q 'not found'; then
    echo "Chromium shared libraries already satisfied for $chrome_bin; skipping apt install-deps."
    exit 0
  fi

  echo 'Missing Chromium shared libraries; installing Playwright system deps.' >&2
  # Bound apt network calls so an EC2/Azure Ubuntu mirror stall fails fast.
  sudo -n tee /etc/apt/apt.conf.d/99openpost-ci-timeouts >/dev/null <<'EOF'
Acquire::Retries "2";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
DPkg::Lock::Timeout "30";
EOF
  bunx --no-install playwright install-deps chromium
  exit 0
fi

fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

# Monthly BtbN autobuilds are retained long term. Update all three values
# together; the setup action keys its cache on this file.
ffmpeg_release=autobuild-2026-10-31-12-59
ffmpeg_build=n8.1.3-27-g8dca1586f4
case "$(uname -m)" in
  x86_64)
    ffmpeg_target=linux64-gpl-8.1
    ffmpeg_sha256=41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380
    ;;
  aarch64|arm64)
    ffmpeg_target=linuxarm64-gpl-8.1
    ffmpeg_sha256=a08c0ee6e1c4e02139344b303002dcc7c37cf125d639f1fbd15dabee40fcb525
    ;;
  *)
    echo "No pinned FFmpeg build for $(uname -m)." >&2
    exit 1
    ;;
esac
ffmpeg_name="ffmpeg-$ffmpeg_build-$ffmpeg_target"
ffmpeg_dir="${OPENPOST_FFMPEG_CACHE:-$HOME/.cache/openpost-ffmpeg}/$ffmpeg_name"

if [[ ! -x "$ffmpeg_dir/ffmpeg" || ! -x "$ffmpeg_dir/ffprobe" ]]; then
  echo "Downloading pinned FFmpeg $ffmpeg_name."
  archive="$fixture_dir/ffmpeg.tar.xz"
  curl --fail --location --silent --show-error \
    --retry 5 --retry-all-errors --connect-timeout 20 --max-time 240 \
    --output "$archive" \
    "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/$ffmpeg_release/$ffmpeg_name.tar.xz"
  echo "$ffmpeg_sha256  $archive" | sha256sum --check --quiet -
  tar -xJf "$archive" -C "$fixture_dir"
  rm -rf "$ffmpeg_dir"
  mkdir -p "$ffmpeg_dir"
  mv "$fixture_dir/$ffmpeg_name/bin/ffmpeg" "$fixture_dir/$ffmpeg_name/bin/ffprobe" "$ffmpeg_dir/"
fi

export PATH="$ffmpeg_dir:$PATH"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$ffmpeg_dir" >> "$GITHUB_PATH"
fi

verify_media() {
  local encoder extension video audio audio_encoder codecs
  for encoder in libx264 libvpx libvpx-vp9; do
    case "$encoder" in
      libx264) extension=mp4; video=h264; audio=aac ;;
      libvpx) extension=webm; video=vp8; audio=opus ;;
      libvpx-vp9) extension=vp9.webm; video=vp9; audio=opus ;;
    esac
    audio_encoder="$audio"
    [[ "$audio" != opus ]] || audio_encoder=libopus
    timeout --kill-after=5s 15s ffmpeg -nostdin -v error -y \
      -f lavfi -i color=c=blue:s=160x90:r=10 \
      -f lavfi -i sine=frequency=440:sample_rate=48000 \
      -t 0.2 -c:v "$encoder" -threads 1 \
      -c:a "$audio_encoder" \
      "$fixture_dir/fixture.$extension" || return 1
    codecs="$(timeout --kill-after=5s 15s ffprobe -v error \
      -show_entries stream=codec_name -of csv=p=0 \
      "$fixture_dir/fixture.$extension")" || return 1
    if ! grep -qx "$video" <<< "$codecs" || ! grep -qx "$audio" <<< "$codecs"; then
      echo "Unexpected fixture codecs for $encoder: $codecs" >&2
      return 1
    fi
  done
}

if ! verify_media; then
  echo "Pinned FFmpeg $ffmpeg_name failed fixture encoding and probing." >&2
  exit 1
fi
echo "Using pinned FFmpeg $ffmpeg_name from $ffmpeg_dir."
