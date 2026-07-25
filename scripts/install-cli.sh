#!/bin/sh
set -eu

REPO="rodrgds/openpost"
BIN_NAME="openpost"
MCP_BIN_NAME="openpost-mcp"
INSTALL_MCP="${OPENPOST_INSTALL_MCP:-0}"

fail() {
  printf 'openpost CLI install failed: %s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

usage() {
  cat <<'EOF'
Install the OpenPost CLI from the latest GitHub release.

Usage:
  install-cli.sh [--with-mcp]

Options:
  --with-mcp     Also install the openpost-mcp stdio proxy for desktop MCP clients.
  -h, --help     Show this help.

Environment:
  OPENPOST_INSTALL_MCP=1  Also install openpost-mcp.
EOF
}

truthy() {
  case "$1" in
    1 | true | TRUE | yes | YES | y | Y | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

detect_os() {
  case "$(uname -s)" in
    Linux) printf '%s\n' linux ;;
    Darwin) printf '%s\n' darwin ;;
    *) fail "unsupported platform: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) printf '%s\n' amd64 ;;
    arm64 | aarch64) printf '%s\n' arm64 ;;
    *) fail "unsupported architecture: $(uname -m)" ;;
  esac
}

install_file() {
  src=$1
  dst=$2

  if [ "$(id -u)" -eq 0 ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    chmod 755 "$dst"
    return
  fi

  if mkdir -p "$(dirname "$dst")" 2>/dev/null && cp "$src" "$dst" 2>/dev/null; then
    chmod 755 "$dst"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p "$(dirname "$dst")"
    sudo cp "$src" "$dst"
    sudo chmod 755 "$dst"
    return
  fi

  fail "cannot write $dst and sudo is not available"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-mcp | --install-mcp)
      INSTALL_MCP=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
  shift
done

need curl
need uname
need mktemp

OS=$(detect_os)
ARCH=$(detect_arch)

if [ "$OS" = "darwin" ] && [ "$ARCH" = "amd64" ]; then
  fail "unsupported platform: macOS on amd64; use an arm64 Mac or build from source"
fi

if [ "$(id -u)" -eq 0 ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME:-}/.local/bin"
  [ -n "$INSTALL_DIR" ] || fail "HOME is not set"
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/openpost-install.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

download_and_install() {
  asset=$1
  destination=$2
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
  tmp_file="${TMP_DIR}/${asset}"

  printf 'Downloading %s\n' "$url"
  if ! curl -fsSL "$url" -o "$tmp_file"; then
    fail "download failed for ${url}"
  fi

  install_file "$tmp_file" "$destination"
}

if [ "$(id -u)" -ne 0 ] && ! mkdir -p "$INSTALL_DIR" 2>/dev/null; then
  INSTALL_DIR="/usr/local/bin"
fi

download_and_install "openpost-cli-${OS}-${ARCH}" "${INSTALL_DIR}/${BIN_NAME}"

printf 'Installed OpenPost CLI to %s\n' "${INSTALL_DIR}/${BIN_NAME}"
printf 'Now run: openpost auth login <instance>\n'

if truthy "$INSTALL_MCP"; then
  download_and_install "openpost-mcp-${OS}-${ARCH}" "${INSTALL_DIR}/${MCP_BIN_NAME}"
  printf 'Installed OpenPost MCP proxy to %s\n' "${INSTALL_DIR}/${MCP_BIN_NAME}"
  printf 'After logging in with openpost, run: openpost-mcp --profile <profile>\n'
else
  printf 'To also install the MCP proxy, rerun the installer with --with-mcp.\n'
fi
