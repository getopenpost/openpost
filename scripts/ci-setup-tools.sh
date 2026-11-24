#!/usr/bin/env bash
# Reuse runner media and browser libraries when already satisfied so CI jobs do
# not burn minutes or time out on slow Ubuntu apt mirrors.
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
  -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20
  -o DPkg::Lock::Timeout=30
)
timeout --kill-after=10s 60s sudo -n apt-get "${apt_options[@]}" update
timeout --kill-after=10s 180s sudo -n env DEBIAN_FRONTEND=noninteractive \
  apt-get "${apt_options[@]}" install --yes --no-install-recommends ffmpeg

if ! verify_media; then
  echo 'Media tools remain unusable after installation.' >&2
  exit 1
fi
