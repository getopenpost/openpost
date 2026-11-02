#!/usr/bin/env bash
# Reuse runner media tools only when the fixture encoders and probe actually work.
set -euo pipefail

if [[ "${1:-}" != media || $# != 1 ]]; then
  echo 'Usage: bash scripts/ci-setup-tools.sh media' >&2
  exit 2
fi

fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

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

if verify_media; then
  echo 'Existing FFmpeg and ffprobe passed fixture encoding and probing.'
  exit 0
fi

echo 'Media capability check failed; installing Ubuntu FFmpeg.' >&2
# Runner mirror+file sources can select a slow Azure mirror. Override sources
# only for these apt invocations; leave the runner's managed source files intact.
if [[ "$(lsb_release -is)" != Ubuntu ]]; then
  echo 'Media tool installation requires an Ubuntu runner.' >&2
  exit 1
fi
codename="$(lsb_release -cs)"
if [[ ! "$codename" =~ ^[a-z]+$ ]]; then
  echo 'Invalid Ubuntu release codename.' >&2
  exit 1
fi
archive=https://archive.ubuntu.com/ubuntu
security=https://security.ubuntu.com/ubuntu
case "$(dpkg --print-architecture)" in
  amd64|i386) ;;
  *) archive=https://ports.ubuntu.com/ubuntu-ports; security="$archive" ;;
esac
cat > "$fixture_dir/ubuntu.sources" <<EOF
Types: deb
URIs: $archive
Suites: $codename $codename-updates $codename-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: $security
Suites: $codename-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
# Do not let repository mirrors or package locks consume the test job budget.
apt_options=(
  -o "Dir::Etc::sourcelist=$fixture_dir/ubuntu.sources" -o Dir::Etc::sourceparts=-
  -o APT::Update::Error-Mode=any
  -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20
  -o DPkg::Lock::Timeout=30
)
timeout --kill-after=10s 60s sudo -n apt-get "${apt_options[@]}" update
timeout --kill-after=10s 180s sudo -n env DEBIAN_FRONTEND=noninteractive \
  apt-get "${apt_options[@]}" install --yes --no-install-recommends ffmpeg

if ! verify_media; then
  echo 'Media tools remain unusable after installation.' >&2
  exit 1
fi
